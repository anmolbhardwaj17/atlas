import { Inject, Injectable, Logger } from "@nestjs/common";
import { estimateCostUsd, type LLMUsage } from "@atlas/ai";
import { withOrgScope, type Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import { PG_POOL, ENV } from "../core/tokens";
import { ApiException } from "../common/errors";

/**
 * Per-org LLM spend metering and the monthly cap (deploy-readiness audit, P1).
 *
 * The gap this closes: rate limits bounded how OFTEN the AI could be called and `maxTokens` bounded
 * one response, but nothing bounded total spend, and nothing recorded it. `autoDiagnose` runs
 * unattended off health alerts, so a flapping estate could bill indefinitely with no human in the
 * loop — and afterwards there was no per-org record to explain the invoice.
 *
 * Two deliberate scoping decisions:
 *
 *  1. **Only spend on Atlas's shared platform key is capped.** A BYO-key org is paying its own
 *     provider directly; capping that would be us throttling someone else's budget. BYO usage is
 *     still recorded (the customer wants the visibility) — just never enforced against.
 *  2. **Recording never fails a request.** The answer has already been generated and paid for by the
 *     time usage is known; throwing here would deny the user a response they've been billed for.
 *     A write failure is logged and swallowed. The cap is enforced BEFORE the call instead, where
 *     refusing is still meaningful.
 *
 * The cap is a backstop against runaway automation, not a billing system: it's checked before a call
 * using spend accumulated so far, so a single call can overshoot it. That's intentional — the
 * alternative is pre-estimating tokens, which is guesswork.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** UTC month key (`YYYY-MM`). UTC so the window doesn't shift with server timezone. */
  private period(now = new Date()): string {
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Throw `429` if this org has already spent its monthly allowance on Atlas's shared key. No-op
   * when the cap is disabled (`AI_MONTHLY_USD_CAP=0`) or the org is on its own key.
   */
  async enforceBudget(orgId: string, sharedKey: boolean): Promise<void> {
    const cap = this.env.AI_MONTHLY_USD_CAP;
    if (!sharedKey || cap <= 0) return;

    const spent = await this.spentThisMonth(orgId);
    if (spent < cap) return;

    throw ApiException.tooManyRequests(
      `This organization has reached its monthly AI budget ($${cap.toFixed(2)}). ` +
        `Add your own model key in Settings → AI to continue without the shared-key limit, ` +
        `or wait for the next billing month.`,
    );
  }

  /** Shared-key spend for the current month, in USD. */
  async spentThisMonth(orgId: string, now = new Date()): Promise<number> {
    const period = this.period(now);
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ total: string | null }>(
        `SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total
           FROM ai_usage
          WHERE org_id = $1 AND period = $2 AND shared_key`,
        [orgId, period],
      );
      return Number(rows[0]?.total ?? 0);
    });
  }

  /**
   * Accumulate one call's usage. Best-effort by design (see the class comment) — a failure here is
   * logged, never thrown. `usage` is undefined when the provider couldn't report it (the dev mock,
   * or an OpenAI-compatible endpoint that ignored `stream_options`); that's recorded as a call with
   * zero tokens rather than dropped, so the call count still reflects reality.
   */
  async record(
    orgId: string,
    model: string,
    sharedKey: boolean,
    usage: LLMUsage | undefined,
  ): Promise<void> {
    const u = usage ?? { inputTokens: 0, outputTokens: 0 };
    const cost = estimateCostUsd(model, u);
    try {
      await withOrgScope(this.db, orgId, (c) =>
        c.query(`SELECT app_record_ai_usage($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
          orgId,
          this.period(),
          model,
          sharedKey,
          u.inputTokens,
          u.outputTokens,
          u.cacheReadTokens ?? 0,
          u.cacheWriteTokens ?? 0,
          cost.toFixed(6),
        ]),
      );
    } catch (err) {
      this.logger.warn(`ai usage not recorded for org ${orgId}: ${(err as Error).message}`);
    }
  }
}
