/**
 * Discord "Ask Atlas" service (HTTP interactions). Mirrors the Slack integration's shape:
 *   - interaction POST → verify Ed25519 signature → PING/PONG or resolve org from guild_id → ack
 *     with a DEFERRED response (Discord's 3s window) → answer async → PATCH the followup.
 *   - OAuth callback → verify signed `state` (CSRF + which Atlas org) → exchange code → bind guild.
 *
 * Isolation (R8): a guild binds to exactly one org; every answer runs under that org's scope.
 * Read-only (P2): reads the graph to answer, posts to the customer's own guild — nothing mutates
 * their cloud/repo. No per-install secret: Discord uses one app-level bot token (env), and the
 * followup edit is authorized by the interaction token itself.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { withOrgScope, type Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import { ENV, PG_POOL } from "../core/tokens";
import { AiService } from "../ai/ai.service";
import { verifyDiscordSignature } from "./discord-verify";
import { formatAnswerMessage } from "./discord-embeds";

const OAUTH_AUTHORIZE = "https://discord.com/oauth2/authorize";
const OAUTH_TOKEN = "https://discord.com/api/oauth2/token";
const API_BASE = "https://discord.com/api/v10";
const SCOPES = "applications.commands bot";
const STATE_TTL_MS = 10 * 60_000;
const EPHEMERAL = 64; // Discord message flag: only the invoking user sees it.

// Interaction types / response types (Discord API).
const INTERACTION_PING = 1;
const INTERACTION_COMMAND = 2;
const RESP_PONG = 1;
const RESP_MESSAGE = 4;
const RESP_DEFERRED = 5;

export interface DiscordResult {
  status: number;
  body?: unknown;
}

interface DiscordInteraction {
  type: number;
  token?: string;
  guild_id?: string;
  data?: { name?: string; options?: Array<{ name?: string; value?: unknown }> };
}

export interface DiscordOAuthResponse {
  error?: string;
  guild?: { id?: string; name?: string };
}

export interface OAuthCallbackResult {
  ok: boolean;
  guildName?: string;
  error?: string;
}

function isDiscordHost(url: string): boolean {
  try {
    return new URL(url).hostname === "discord.com";
  } catch {
    return false;
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function ephemeral(content: string): DiscordResult {
  return { status: 200, body: { type: RESP_MESSAGE, data: { content, flags: EPHEMERAL } } };
}

@Injectable()
export class DiscordService {
  private readonly log = new Logger(DiscordService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly ai: AiService,
  ) {}

  // --- OAuth install `state` (HMAC-signed with the client secret) --------------------------------

  private stateKey(): string {
    return this.env.DISCORD_CLIENT_SECRET ?? "";
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
    if (nowMs - Number(ts) > STATE_TTL_MS) return null;
    return { orgId, userId: userId || null };
  }

  buildInstallUrl(orgId: string, userId: string | null): string | null {
    if (!this.env.DISCORD_APPLICATION_ID) return null;
    const u = new URL(OAUTH_AUTHORIZE);
    u.searchParams.set("client_id", this.env.DISCORD_APPLICATION_ID);
    u.searchParams.set("scope", SCOPES);
    u.searchParams.set("permissions", "0");
    u.searchParams.set("response_type", "code");
    u.searchParams.set("redirect_uri", this.redirectUri());
    u.searchParams.set("state", this.signInstallState(orgId, userId));
    return u.toString();
  }

  private redirectUri(): string {
    return `${this.env.PUBLIC_API_URL.replace(/\/$/, "")}/discord/oauth/callback`;
  }

  // --- Interaction handling -----------------------------------------------------------------------

  async interaction(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<DiscordResult> {
    const v = verifyDiscordSignature({
      publicKey: this.env.DISCORD_PUBLIC_KEY ?? "",
      timestamp: header(headers, "x-signature-timestamp"),
      rawBody,
      signature: header(headers, "x-signature-ed25519"),
    });
    if (!v.valid) {
      this.log.warn(`discord interaction rejected: ${v.reason}`);
      return { status: 401 };
    }

    let body: DiscordInteraction;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as DiscordInteraction;
    } catch {
      return { status: 400 };
    }

    // Discord validates the endpoint by sending a PING; echo a PONG.
    if (body.type === INTERACTION_PING) return { status: 200, body: { type: RESP_PONG } };
    if (body.type !== INTERACTION_COMMAND) return { status: 200, body: { type: RESP_PONG } };

    const question = extractQuestion(body);
    if (!question) {
      return ephemeral(
        "Ask me about your infrastructure — e.g. `/atlas what depends on orders-db?`",
      );
    }
    const orgId = await this.orgForGuild(body.guild_id ?? "");
    if (!orgId) {
      return ephemeral(
        "This Discord server isn't connected to Atlas yet. An admin can connect it from Atlas → Integrations.",
      );
    }

    // Answer async (LLM > 3s) and edit the deferred message via the interaction token.
    const token = body.token;
    if (token) void this.respond(orgId, question, token);
    return { status: 200, body: { type: RESP_DEFERRED } };
  }

  /** Resolve the org bound to a Discord guild (pre-auth, via the SECURITY DEFINER resolver). */
  async orgForGuild(guildId: string): Promise<string | null> {
    if (!guildId) return null;
    const { rows } = await this.db.query<{ org: string | null }>(
      "SELECT app_discord_org($1) AS org",
      [guildId],
    );
    return rows[0]?.org ?? null;
  }

  /** Answer (org-scoped, grounded) and edit the deferred interaction response with the result. */
  async respond(orgId: string, question: string, interactionToken: string): Promise<void> {
    const appId = this.env.DISCORD_APPLICATION_ID ?? "";
    const url = `${API_BASE}/webhooks/${appId}/${interactionToken}/messages/@original`;
    try {
      const answer = await this.ai.answerForIntegration(orgId, question);
      const message = formatAnswerMessage(
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
        this.env.WEB_ORIGIN,
      );
      await this.httpPatchJson(url, message);
    } catch (e) {
      this.log.error(`discord answer failed: ${e instanceof Error ? e.message : String(e)}`);
      await this.httpPatchJson(url, {
        content: "Atlas hit an error answering that. Please try again.",
      }).catch(() => {});
    }
  }

  // --- OAuth callback -----------------------------------------------------------------------------

  async handleOAuthCallback(code: string, state: string): Promise<OAuthCallbackResult> {
    const st = this.verifyInstallState(state);
    if (!st) return { ok: false, error: "invalid_state" };

    const res = await this.oauthExchange(code);
    if (res.error || !res.guild || !res.guild.id) {
      return { ok: false, error: res.error ?? "exchange_failed" };
    }
    const guildId = res.guild.id;
    const guildName = res.guild.name ?? null;

    const existing = await this.orgForGuild(guildId);
    if (existing && existing !== st.orgId) {
      return { ok: false, error: "already_connected_to_another_org" };
    }

    await withOrgScope(this.db, st.orgId, async (c) => {
      await c.query(
        `INSERT INTO discord_installations (org_id, guild_id, guild_name, installed_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (guild_id) DO UPDATE SET guild_name = EXCLUDED.guild_name, updated_at = now()
         WHERE discord_installations.org_id = $1`,
        [st.orgId, guildId, guildName, st.userId],
      );
    });
    return guildName ? { ok: true, guildName } : { ok: true };
  }

  resultRedirectUrl(res: OAuthCallbackResult): string {
    const base = `${this.env.WEB_ORIGIN.replace(/\/$/, "")}/integrations`;
    return res.ok
      ? `${base}?discord=connected`
      : `${base}?discord=error&reason=${encodeURIComponent(res.error ?? "unknown")}`;
  }

  async installationFor(orgId: string): Promise<{ guildName: string | null } | null> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ guild_name: string | null }>(
        "SELECT guild_name FROM discord_installations WHERE org_id = $1 LIMIT 1",
        [orgId],
      );
      return rows[0] ? { guildName: rows[0].guild_name } : null;
    });
  }

  async uninstall(orgId: string): Promise<{ disconnected: boolean }> {
    return withOrgScope(this.db, orgId, async (c) => {
      const res = await c.query("DELETE FROM discord_installations WHERE org_id = $1", [orgId]);
      return { disconnected: (res.rowCount ?? 0) > 0 };
    });
  }

  // --- Outbound (isolated for tests + host-guarded) -----------------------------------------------

  protected async oauthExchange(code: string): Promise<DiscordOAuthResponse> {
    const body = new URLSearchParams({
      client_id: this.env.DISCORD_APPLICATION_ID ?? "",
      client_secret: this.env.DISCORD_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri(),
    });
    const r = await fetch(OAUTH_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return (await r.json()) as DiscordOAuthResponse;
  }

  protected async httpPatchJson(url: string, body: unknown): Promise<void> {
    if (!isDiscordHost(url)) throw new Error("refusing to PATCH a non-Discord host");
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

/** The `/atlas` command's first string option is the question. */
function extractQuestion(body: DiscordInteraction): string {
  const opt = body.data?.options?.find((o) => typeof o.value === "string");
  return typeof opt?.value === "string" ? opt.value.trim() : "";
}
