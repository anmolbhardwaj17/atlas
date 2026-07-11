import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import { PG_POOL, ENV } from "../core/tokens";
import { EmailService } from "../core/email.service";
import { GraphService } from "../graph/graph.service";

type Sev = "high" | "medium" | "low";

interface Digest {
  resources: number;
  counts: Record<Sev, number>;
  postureScore: number | null;
  findings: Array<{ severity: Sev; title: string; url: string }>;
}

/**
 * Weekly posture digest (#44). Builds a per-org summary from the SAME cited findings the dashboard
 * shows (honest — "all clear" is a real state, no invented problems), and mails it to each active
 * member who hasn't opted out. Cross-org send runs from a scheduler, so recipients come from a
 * SECURITY DEFINER function; the unsubscribe link is a token-signed, one-click opt-out.
 */
@Injectable()
export class WeeklyDigestService {
  private readonly logger = new Logger(WeeklyDigestService.name);
  private readonly webOrigin: string;
  private readonly secret: string;

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) env: Env,
    private readonly graph: GraphService,
    private readonly email: EmailService,
  ) {
    this.webOrigin = env.WEB_ORIGIN;
    this.secret = env.SECRET_ENCRYPTION_KEY ?? "atlas-digest-dev";
  }

  /** Build one org's digest from the live dashboard summary (same findings, same posture). */
  async buildDigest(orgId: string): Promise<Digest> {
    const s = await this.graph.summary(orgId);
    const counts: Record<Sev, number> = { high: 0, medium: 0, low: 0 };
    for (const f of s.findings) {
      if (f.severity === "high" || f.severity === "medium" || f.severity === "low")
        counts[f.severity] += 1;
    }
    const pillars = Object.values(s.insights.posture).filter(
      (v): v is number => typeof v === "number",
    );
    const postureScore =
      pillars.length > 0 ? Math.round(pillars.reduce((a, b) => a + b, 0) / pillars.length) : null;
    const findings = s.findings.slice(0, 6).map((f) => ({
      severity: f.severity,
      title: f.title,
      url: `${this.webOrigin}/insights/${f.id}`,
    }));
    return { resources: s.inventory.resources, counts, postureScore, findings };
  }

  /**
   * Claim this week's send atomically and, only if we won the claim, send. Safe to call from every
   * API instance every tick — exactly one caller per `periodKey` proceeds (see migration 0048).
   * Returns null when the week was already claimed (nothing to do).
   */
  async claimAndSend(periodKey: string): Promise<{ orgs: number; sent: number } | null> {
    const { rows } = await this.db.query<{ app_claim_digest_period: boolean }>(
      "SELECT app_claim_digest_period($1)",
      [periodKey],
    );
    if (!rows[0]?.app_claim_digest_period) return null;
    this.logger.log(`Claimed weekly digest period ${periodKey}; sending.`);
    return this.sendWeeklyDigests();
  }

  /** Send the weekly digest to every eligible recipient across all orgs. Best-effort per send. */
  async sendWeeklyDigests(): Promise<{ orgs: number; sent: number }> {
    const { rows } = await this.db.query<{
      org_id: string;
      org_name: string;
      user_id: string;
      email: string;
    }>("SELECT org_id, org_name, user_id, email FROM app_weekly_digest_recipients()");
    const byOrg = new Map<
      string,
      { name: string; recipients: Array<{ userId: string; email: string }> }
    >();
    for (const r of rows) {
      const g = byOrg.get(r.org_id) ?? { name: r.org_name, recipients: [] };
      g.recipients.push({ userId: r.user_id, email: r.email });
      byOrg.set(r.org_id, g);
    }

    let sent = 0;
    for (const [orgId, org] of byOrg) {
      let digest: Digest;
      try {
        digest = await this.buildDigest(orgId);
      } catch (err) {
        this.logger.error(`Digest build failed for org ${orgId}: ${(err as Error).message}`);
        continue;
      }
      for (const rcpt of org.recipients) {
        const ok = await this.email.sendWeeklyDigest({
          to: rcpt.email,
          orgName: org.name,
          postureScore: digest.postureScore,
          resources: digest.resources,
          counts: digest.counts,
          findings: digest.findings,
          insightsUrl: `${this.webOrigin}/insights`,
          unsubscribeUrl: this.unsubscribeUrl(rcpt.userId, orgId),
        });
        if (ok) sent += 1;
      }
    }
    this.logger.log(`Weekly digest: ${sent} email(s) across ${byOrg.size} org(s).`);
    return { orgs: byOrg.size, sent };
  }

  /** Honor an unsubscribe from a token-signed email link. Returns true if it was applied. */
  async unsubscribe(userId: string, orgId: string, token: string): Promise<boolean> {
    if (!this.verifyToken(userId, orgId, token)) return false;
    const { rows } = await this.db.query<{ app_digest_unsubscribe: boolean }>(
      "SELECT app_digest_unsubscribe($1::uuid, $2::uuid)",
      [userId, orgId],
    );
    return rows[0]?.app_digest_unsubscribe ?? false;
  }

  private token(userId: string, orgId: string): string {
    return createHmac("sha256", this.secret)
      .update(`${userId}:${orgId}`)
      .digest("hex")
      .slice(0, 32);
  }
  private unsubscribeUrl(userId: string, orgId: string): string {
    const t = this.token(userId, orgId);
    return `${this.webOrigin}/unsubscribe?u=${userId}&o=${orgId}&t=${t}`;
  }
  private verifyToken(userId: string, orgId: string, token: string): boolean {
    const expected = this.token(userId, orgId);
    if (token.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }
}
