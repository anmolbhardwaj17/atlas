/**
 * Slack "Ask Atlas" service. Two inbound flows, both starting from an UNAUTHENTICATED request that
 * we make safe before trusting:
 *   - slash command → verify signature → resolve org from team_id → ack fast → answer async.
 *   - OAuth callback → verify signed `state` (CSRF + which Atlas org) → exchange code → bind install.
 *
 * Isolation (R8): a workspace (`team_id`) binds to exactly one org; every answer runs under that
 * org's scope, so a question can only ever see that org's graph. Read-only (P2): we read the graph
 * to answer and post to the customer's own consented workspace — nothing mutates their cloud/repo.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withOrgScope, type Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import type { SecretBroker } from "@atlas/ingest";
import { ENV, PG_POOL } from "../core/tokens";
import { SECRET_BROKER } from "../connections/tokens";
import { AiService } from "../ai/ai.service";
import { verifySlackSignature } from "./slack-verify";
import { formatAnswerBlocks } from "./slack-blocks";

const OAUTH_AUTHORIZE = "https://slack.com/oauth/v2/authorize";
const OAUTH_ACCESS = "https://slack.com/api/oauth.v2.access";
const SCOPES = "commands"; // v1: slash command only; replies go to the request's response_url.
const STATE_TTL_MS = 10 * 60_000;

export interface SlackCommandResult {
  status: number;
  body?: unknown;
}

/** The subset of Slack's oauth.v2.access response we use. */
export interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  scope?: string;
  team?: { id?: string; name?: string };
}

export interface OAuthCallbackResult {
  ok: boolean;
  teamName?: string;
  error?: string;
}

/** Slack posts slash-command replies to hooks.slack.com; the API lives at slack.com. */
function isSlackHost(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "hooks.slack.com" || h === "slack.com";
  } catch {
    return false;
  }
}

@Injectable()
export class SlackService {
  private readonly log = new Logger(SlackService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
    private readonly ai: AiService,
  ) {}

  // --- OAuth install `state` (HMAC-signed: CSRF guard + carries the initiating org/user) ----------

  private stateKey(): string {
    return this.env.SLACK_SIGNING_SECRET ?? "";
  }

  signInstallState(orgId: string, userId: string | null, nowMs: number = Date.now()): string {
    const payload = Buffer.from(`${orgId}.${userId ?? ""}.${nowMs}`).toString("base64url");
    const sig = createHmac("sha256", this.stateKey()).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  verifyInstallState(
    state: string,
    nowMs: number = Date.now(),
  ): { orgId: string; userId: string | null } | null {
    if (!this.stateKey()) return null;
    const dot = state.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = createHmac("sha256", this.stateKey()).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const e = Buffer.from(expected);
    if (a.length !== e.length || !timingSafeEqual(a, e)) return null;
    const [orgId, userId, ts] = Buffer.from(payload, "base64url").toString("utf8").split(".");
    if (!orgId || !ts || !Number.isFinite(Number(ts))) return null;
    if (nowMs - Number(ts) > STATE_TTL_MS) return null; // expired
    return { orgId, userId: userId || null };
  }

  /** The "Add to Slack" URL for an admin to install the app into their workspace. Null if unconfigured. */
  buildInstallUrl(orgId: string, userId: string | null): string | null {
    if (!this.env.SLACK_CLIENT_ID) return null;
    const u = new URL(OAUTH_AUTHORIZE);
    u.searchParams.set("client_id", this.env.SLACK_CLIENT_ID);
    u.searchParams.set("scope", SCOPES);
    u.searchParams.set("redirect_uri", this.redirectUri());
    u.searchParams.set("state", this.signInstallState(orgId, userId));
    return u.toString();
  }

  private redirectUri(): string {
    return `${this.env.PUBLIC_API_URL.replace(/\/$/, "")}/slack/oauth/callback`;
  }

  // --- Slash command ------------------------------------------------------------------------------

  /**
   * Handle `POST /slack/command`. Verifies the signature, then acks within Slack's 3s window and
   * runs the (slower, LLM-backed) answer asynchronously, delivering it to the request's response_url.
   */
  async command(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<SlackCommandResult> {
    const v = verifySlackSignature({
      signingSecret: this.env.SLACK_SIGNING_SECRET ?? "",
      timestamp: header(headers, "x-slack-request-timestamp"),
      rawBody,
      signature: header(headers, "x-slack-signature"),
    });
    if (!v.valid) {
      this.log.warn(`slack command rejected: ${v.reason}`);
      return { status: 401 };
    }

    const params = new URLSearchParams(rawBody.toString("utf8"));
    const teamId = params.get("team_id") ?? "";
    const text = (params.get("text") ?? "").trim();
    const responseUrl = params.get("response_url") ?? "";

    if (!text) {
      return ephemeral(
        "Ask me about your infrastructure — e.g. `/atlas what depends on orders-db?`",
      );
    }

    const orgId = await this.orgForTeam(teamId);
    if (!orgId) {
      return ephemeral(
        "This Slack workspace isn't connected to Atlas yet. An admin can connect it from Atlas → Integrations.",
      );
    }

    // The answer can exceed Slack's 3s ack window, so ack now and deliver via response_url.
    if (responseUrl && isSlackHost(responseUrl)) {
      void this.respond(orgId, text, responseUrl);
    }
    return ephemeral(":hourglass_flowing_sand: Atlas is looking into it…");
  }

  /** Resolve the org bound to a Slack workspace (pre-auth, via the SECURITY DEFINER resolver). */
  async orgForTeam(teamId: string): Promise<string | null> {
    if (!teamId) return null;
    const { rows } = await this.db.query<{ org: string | null }>(
      "SELECT app_slack_org($1) AS org",
      [teamId],
    );
    return rows[0]?.org ?? null;
  }

  /** Answer the question (org-scoped, grounded) and post the formatted result to the response_url. */
  async respond(orgId: string, question: string, responseUrl: string): Promise<void> {
    try {
      const answer = await this.ai.answerForIntegration(orgId, question);
      const blocks = formatAnswerBlocks(
        {
          grounded: answer.grounded,
          text: answer.text,
          confidence: answer.confidence,
          citations: answer.citations.map((c) => ({
            number: c.number,
            provenanceUrl: c.provenanceUrl,
            kind: c.kind,
          })),
        },
        question,
        this.env.WEB_ORIGIN,
      );
      await this.httpPostJson(responseUrl, {
        response_type: "in_channel",
        replace_original: false,
        blocks,
      });
    } catch (e) {
      this.log.error(`slack answer failed: ${e instanceof Error ? e.message : String(e)}`);
      await this.httpPostJson(responseUrl, {
        response_type: "ephemeral",
        text: "Atlas hit an error answering that. Please try again.",
      }).catch(() => {});
    }
  }

  // --- OAuth callback -----------------------------------------------------------------------------

  async handleOAuthCallback(code: string, state: string): Promise<OAuthCallbackResult> {
    const st = this.verifyInstallState(state);
    if (!st) return { ok: false, error: "invalid_state" };

    const res = await this.oauthExchange(code);
    if (!res.ok || !res.team || !res.team.id || !res.access_token) {
      return { ok: false, error: res.error ?? "exchange_failed" };
    }
    // Capture everything now, while the guard's narrowing holds — the awaits below re-widen it.
    const teamId = res.team.id;
    const teamName = res.team.name ?? null;
    const botUserId = res.bot_user_id ?? null;
    const scope = res.scope ?? null;
    const botToken = res.access_token;

    // A workspace binds to ONE org. If it's already bound elsewhere, refuse (never silently re-point).
    const existing = await this.orgForTeam(teamId);
    if (existing && existing !== st.orgId) {
      return { ok: false, error: "already_connected_to_another_org" };
    }

    const secretRef = await this.secrets.put(st.orgId, { botToken });
    await withOrgScope(this.db, st.orgId, async (c) => {
      await c.query(
        `INSERT INTO slack_installations
           (org_id, team_id, team_name, bot_user_id, bot_secret_ref, scopes, installed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (team_id) DO UPDATE SET
           team_name = EXCLUDED.team_name,
           bot_user_id = EXCLUDED.bot_user_id,
           bot_secret_ref = EXCLUDED.bot_secret_ref,
           scopes = EXCLUDED.scopes,
           updated_at = now()
         WHERE slack_installations.org_id = $1`,
        [st.orgId, teamId, teamName, botUserId, secretRef, scope, st.userId],
      );
    });
    return teamName ? { ok: true, teamName } : { ok: true };
  }

  /** Where to bounce the browser after the OAuth dance — back to the Integrations hub with status. */
  resultRedirectUrl(res: OAuthCallbackResult): string {
    const base = `${this.env.WEB_ORIGIN.replace(/\/$/, "")}/integrations`;
    return res.ok
      ? `${base}?slack=connected`
      : `${base}?slack=error&reason=${encodeURIComponent(res.error ?? "unknown")}`;
  }

  /** Whether this org has a connected Slack workspace (for the Integrations hub). */
  async installationFor(orgId: string): Promise<{ teamName: string | null } | null> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ team_name: string | null }>(
        "SELECT team_name FROM slack_installations WHERE org_id = $1 LIMIT 1",
        [orgId],
      );
      return rows[0] ? { teamName: rows[0].team_name } : null;
    });
  }

  /** Disconnect the workspace: drop the install row and shred the stored bot token. Idempotent. */
  async uninstall(orgId: string): Promise<{ disconnected: boolean }> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ bot_secret_ref: string | null }>(
        "DELETE FROM slack_installations WHERE org_id = $1 RETURNING bot_secret_ref",
        [orgId],
      );
      const ref = rows[0]?.bot_secret_ref;
      if (ref) await this.secrets.delete(ref).catch(() => {});
      return { disconnected: rows.length > 0 };
    });
  }

  // --- Outbound (isolated for tests + host-guarded) -----------------------------------------------

  /** Exchange an OAuth code for a bot token. Isolated so tests can stub the Slack round-trip. */
  protected async oauthExchange(code: string): Promise<SlackOAuthResponse> {
    const body = new URLSearchParams({
      client_id: this.env.SLACK_CLIENT_ID ?? "",
      client_secret: this.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: this.redirectUri(),
    });
    const r = await fetch(OAUTH_ACCESS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return (await r.json()) as SlackOAuthResponse;
  }

  /** POST JSON to a Slack host only (defence-in-depth SSRF guard; the URL is already signed-request-derived). */
  protected async httpPostJson(url: string, body: unknown): Promise<void> {
    if (!isSlackHost(url)) throw new Error("refusing to POST to a non-Slack host");
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function ephemeral(text: string): SlackCommandResult {
  return { status: 200, body: { response_type: "ephemeral", text } };
}
