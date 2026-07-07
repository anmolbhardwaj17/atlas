import { Inject, Injectable, Logger } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import { PG_POOL, ENV } from "../core/tokens";
import { ApiException } from "../common/errors";
import { AiService } from "../ai/ai.service";

/**
 * Proactive notifications (pull → push). An org sets an outbound channel (Slack incoming
 * webhook); the dispatcher then pushes two things:
 *   - REAL-TIME ALERTS: health transitions (something broke / recovered) since the last
 *     alert watermark - the "has your back" moment.
 *   - A DAILY DIGEST: a once-a-day rollup of what changed + what needs attention.
 * All reads/sends are org-scoped (RLS). The webhook URL is a bearer-capability secret, so
 * it is never returned to the client - GET only reports that a channel is configured.
 */
export type ChannelKind = "slack" | "discord" | "msteams";

export const CHANNEL_KINDS: ChannelKind[] = ["slack", "discord", "msteams"];

/** One configured outbound channel, as reported to the client (webhook itself never returned). */
export interface ChannelSummary {
  kind: ChannelKind;
  enabled: boolean;
  /** Masked hint of the webhook (last segment), never the full URL. */
  hint: string | null;
}

/** Per-kind webhook validation + labels. All three take a simple incoming-webhook POST. */
const CHANNEL_META: Record<ChannelKind, { label: string; validate: (url: string) => boolean }> = {
  slack: {
    label: "Slack",
    validate: (u) => /^https:\/\/hooks\.slack\.com\/services\/\S+$/.test(u),
  },
  discord: {
    label: "Discord",
    validate: (u) => /^https:\/\/(canary\.|ptb\.)?discord(app)?\.com\/api\/webhooks\/\S+$/.test(u),
  },
  msteams: {
    label: "Microsoft Teams",
    validate: (u) => /^https:\/\/\S+\.webhook\.office\.com\/\S+$/.test(u),
  },
};

/** One row in the in-app notification feed (the bell). */
export interface NotificationItem {
  id: string;
  kind: string;
  severity: "info" | "success" | "warning" | "danger";
  title: string;
  body: string | null;
  href: string | null;
  /** The source node's kind (e.g. "aws.rds.instance") so the UI can show its real logo. */
  nodeKind: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  id: string;
  kind: string;
  severity: NotificationItem["severity"];
  title: string;
  body: string | null;
  href: string | null;
  node_kind: string | null;
  read_at: Date | null;
  created_at: Date;
}

interface ChannelRow {
  kind: string;
  config: { webhookUrl?: string };
  enabled: boolean;
  last_alert_at: Date;
  last_digest_at: Date | null;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly ai: AiService,
  ) {}

  /** All configured outbound channels for the org (Slack / Discord / Teams). */
  async listChannels(orgId: string): Promise<ChannelSummary[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<ChannelRow>(
        `SELECT kind, config, enabled FROM notification_channels ORDER BY created_at ASC`,
      );
      return rows
        .filter((r) => CHANNEL_KINDS.includes(r.kind as ChannelKind))
        .map((r) => {
          const tail = (r.config.webhookUrl ?? "").split("/").pop() ?? "";
          return {
            kind: r.kind as ChannelKind,
            enabled: r.enabled,
            hint: tail ? `…/${tail.slice(0, 6)}…` : null,
          };
        });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // In-app notification feed (the bell). Rows are derived idempotently from the
  // change timeline, so the feed is always fresh when a user opens it - no
  // cross-org background job needed. Read state is org-level (a shared inbox).
  // ─────────────────────────────────────────────────────────────────────────

  /** The feed a user sees when they open the bell: recent notifications + the unread count. */
  async listFeed(
    orgId: string,
    limit = 30,
  ): Promise<{ items: NotificationItem[]; unread: number }> {
    await this.syncFeed(orgId);
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<NotificationRow>(
        `SELECT id, kind, severity, title, body, href, node_kind, read_at, created_at
           FROM notifications ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
      const { rows: cnt } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL`,
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          severity: r.severity,
          title: r.title,
          body: r.body,
          href: r.href,
          nodeKind: r.node_kind,
          readAt: r.read_at ? r.read_at.toISOString() : null,
          createdAt: r.created_at.toISOString(),
        })),
        unread: cnt[0]?.n ?? 0,
      };
    });
  }

  async markRead(orgId: string, id: string): Promise<void> {
    await withOrgScope(this.db, orgId, (c) =>
      c.query(`UPDATE notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL`, [id]),
    );
  }

  async markAllRead(orgId: string): Promise<void> {
    await withOrgScope(this.db, orgId, (c) =>
      c.query(`UPDATE notifications SET read_at = now() WHERE read_at IS NULL`),
    );
  }

  /**
   * Materialise feed rows from the change timeline. Idempotent: `dedupe_key` = `health:<eventId>`
   * with a unique (org_id, dedupe_key), so re-running only ever inserts genuinely-new events.
   * Health transitions are the "something happened" signal worth surfacing in the bell.
   */
  private async syncFeed(orgId: string): Promise<void> {
    await withOrgScope(this.db, orgId, (c) =>
      c.query(
        `INSERT INTO notifications
                (org_id, kind, severity, title, body, href, node_kind, dedupe_key, created_at)
         SELECT e.org_id,
                'health',
                CASE e.evidence->>'to'
                  WHEN 'healthy'   THEN 'success'
                  WHEN 'unhealthy' THEN 'danger'
                  ELSE 'warning'
                END,
                COALESCE(n.name, e.node_id::text) ||
                  CASE e.evidence->>'to'
                    WHEN 'healthy'   THEN ' recovered'
                    WHEN 'unhealthy' THEN ' went down'
                    ELSE ' is degraded'
                  END,
                e.title,
                '/map',
                n.kind,
                'health:' || e.id,
                e.occurred_at
           FROM node_events e
           JOIN nodes n ON n.id = e.node_id
          WHERE e.kind = 'health_transition'
            AND e.occurred_at > now() - interval '30 days'
         ON CONFLICT (org_id, dedupe_key) DO NOTHING`,
      ),
    );
  }

  /** Set (or replace) a channel's webhook. Validates the URL shape for that channel kind. */
  async setChannel(
    orgId: string,
    kind: ChannelKind,
    webhookUrl: string,
  ): Promise<ChannelSummary[]> {
    const meta = CHANNEL_META[kind];
    if (!meta) throw new ApiException(422, "validation_failed", "Unknown channel.");
    const url = webhookUrl.trim();
    if (!meta.validate(url)) {
      throw new ApiException(
        422,
        "validation_failed",
        `That doesn't look like a ${meta.label} incoming-webhook URL.`,
      );
    }
    await withOrgScope(this.db, orgId, (c) =>
      c.query(
        `INSERT INTO notification_channels (org_id, kind, config, enabled)
         VALUES ($1, $2, $3::jsonb, true)
         ON CONFLICT (org_id, kind) DO UPDATE
           SET config = EXCLUDED.config, enabled = true, updated_at = now()`,
        [orgId, kind, JSON.stringify({ webhookUrl: url })],
      ),
    );
    return this.listChannels(orgId);
  }

  async removeChannel(orgId: string, kind: ChannelKind): Promise<ChannelSummary[]> {
    await withOrgScope(this.db, orgId, (c) =>
      c.query(`DELETE FROM notification_channels WHERE kind = $1`, [kind]),
    );
    return this.listChannels(orgId);
  }

  /** Send a sample message so the user sees it land in the chosen channel. */
  async testChannel(
    orgId: string,
    kind: ChannelKind,
  ): Promise<{ delivered: boolean; message: string }> {
    const url = await this.webhookFor(orgId, kind);
    const label = CHANNEL_META[kind]?.label ?? "channel";
    if (!url)
      throw new ApiException(409, "invalid_state_transition", `No ${label} channel configured.`);
    const ok = await postWebhook(
      kind,
      url,
      "👋 *Atlas is connected.* You'll get a heads-up here when something in your estate breaks, gets exposed, or needs attention — plus a short daily digest.",
    );
    return ok
      ? { delivered: true, message: `Sent — check your ${label} channel.` }
      : {
          delivered: false,
          message: `${label} rejected the message. Double-check the webhook URL.`,
        };
  }

  private async webhookFor(orgId: string, kind: ChannelKind): Promise<string | null> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ config: { webhookUrl?: string } }>(
        `SELECT config FROM notification_channels WHERE kind = $1 AND enabled = true LIMIT 1`,
        [kind],
      );
      return rows[0]?.config.webhookUrl ?? null;
    });
  }

  /**
   * Dispatch pending pushes for one org: real-time health alerts since the watermark, and a
   * daily digest if 24h have passed. Advances the watermarks so nothing repeats. Best-effort:
   * a Slack failure is logged, not fatal, and the watermark still advances on alerts so a
   * broken webhook doesn't wedge the queue.
   */
  async dispatch(orgId: string): Promise<void> {
    const channels = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<ChannelRow>(
        `SELECT kind, config, enabled, last_alert_at, last_digest_at
           FROM notification_channels WHERE enabled = true`,
      );
      return rows.filter(
        (r) => CHANNEL_KINDS.includes(r.kind as ChannelKind) && r.config.webhookUrl,
      );
    });
    if (channels.length === 0) return;

    // Keep the in-app feed (the bell) fresh for this org too.
    await this.syncFeed(orgId).catch(() => {});

    // ── Real-time alerts: health transitions since the EARLIEST channel watermark ──
    // (compute + auto-diagnose once for the org, then fan out to every channel that's behind).
    const earliest = channels.map((c) => c.last_alert_at).reduce((a, b) => (a < b ? a : b));
    const alerts = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        title: string;
        occurred_at: Date;
        node_name: string | null;
        node_id: string;
        to_state: string;
      }>(
        `SELECT e.title, e.occurred_at, n.name AS node_name, n.id AS node_id,
                e.evidence->>'to' AS to_state
           FROM node_events e JOIN nodes n ON n.id = e.node_id
          WHERE e.kind = 'health_transition' AND e.occurred_at > $1
          ORDER BY e.occurred_at ASC LIMIT 20`,
        [earliest],
      );
      return rows;
    });

    if (alerts.length > 0) {
      const lines = alerts.map((a) => {
        const recovered = a.to_state === "healthy";
        const icon = recovered ? "✅" : a.to_state === "unhealthy" ? "🔴" : "🟠";
        return `${icon} *${a.node_name ?? a.node_id}* — ${a.title}`;
      });
      // AUTONOMOUS AGENT: for the newly-broken resources (not recoveries), Atlas investigates
      // on its own - runs the agentic diagnose loop and appends its cited hypothesis, so the
      // alert arrives already diagnosed. Capped so a flapping estate can't run away on cost;
      // best-effort so a slow/absent model never blocks the alert. Computed once per org.
      const broken = alerts.filter((a) => a.to_state !== "healthy").slice(0, 2);
      const diagnoses: string[] = [];
      for (const b of broken) {
        const subject = b.node_name ?? b.node_id;
        const hypothesis = await this.ai.autoDiagnose(orgId, subject).catch(() => null);
        if (hypothesis) diagnoses.push(`\n🤖 *Atlas looked into ${subject}:*\n${hypothesis}`);
      }

      const text =
        `*Atlas — ${alerts.length} health ${alerts.length === 1 ? "change" : "changes"}*\n` +
        `${lines.join("\n")}` +
        `${diagnoses.join("")}` +
        `\n[Open the map →](${this.webUrl()}/map)`;
      const latest = alerts[alerts.length - 1]?.occurred_at ?? new Date();

      for (const ch of channels) {
        if (ch.last_alert_at >= latest || !ch.config.webhookUrl) continue; // already caught up
        await postWebhook(ch.kind as ChannelKind, ch.config.webhookUrl, text);
        await withOrgScope(this.db, orgId, (c) =>
          c.query(`UPDATE notification_channels SET last_alert_at = $1 WHERE kind = $2`, [
            latest,
            ch.kind,
          ]),
        );
      }
    }

    // ── Daily digest: once per 24h, per channel ──
    const digest = await this.buildDigest(orgId);
    for (const ch of channels) {
      const due = !ch.last_digest_at || Date.now() - ch.last_digest_at.getTime() > 24 * 3_600_000;
      if (!due || !ch.config.webhookUrl) continue;
      if (digest) await postWebhook(ch.kind as ChannelKind, ch.config.webhookUrl, digest);
      await withOrgScope(this.db, orgId, (c) =>
        c.query(`UPDATE notification_channels SET last_digest_at = now() WHERE kind = $1`, [
          ch.kind,
        ]),
      );
    }
  }

  /** A once-a-day rollup: 24h of change events + the current headline findings. */
  private async buildDigest(orgId: string): Promise<string | null> {
    return withOrgScope(this.db, orgId, async (c) => {
      const events = await c.query<{ kind: string; n: number }>(
        `SELECT kind, count(*)::int AS n FROM node_events
          WHERE occurred_at > now() - interval '24 hours' GROUP BY kind`,
      );
      const byKind = new Map(events.rows.map((r) => [r.kind, r.n]));
      const health = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM nodes
          WHERE deleted_at IS NULL
            AND attributes->'health'->>'state' IN ('degraded','unhealthy')`,
      );
      const vulns = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM nodes
          WHERE kind = 'security.vulnerability' AND status <> 'deleted'`,
      );

      const deploys = byKind.get("pr_merged") ?? 0;
      const changes = byKind.get("config_change") ?? 0;
      const transitions = byKind.get("health_transition") ?? 0;
      const unhealthy = health.rows[0]?.n ?? 0;
      const vulnCount = vulns.rows[0]?.n ?? 0;

      // A digest with nothing worth saying is noise - skip it.
      if (deploys + changes + transitions + unhealthy === 0) return null;

      const parts = [
        "*Atlas — your daily estate digest*",
        `In the last 24h: *${deploys}* merged PR${deploys === 1 ? "" : "s"}, *${changes}* cloud config change${changes === 1 ? "" : "s"}, *${transitions}* health change${transitions === 1 ? "" : "s"}.`,
      ];
      if (unhealthy > 0)
        parts.push(
          `🔴 *${unhealthy}* resource${unhealthy === 1 ? " is" : "s are"} unhealthy or degraded right now.`,
        );
      if (vulnCount > 0)
        parts.push(
          `🛡️ *${vulnCount}* known ${vulnCount === 1 ? "vulnerability" : "vulnerabilities"} in your dependencies.`,
        );
      parts.push(`[Open your dashboard →](${this.webUrl()}/dashboard)`);
      return parts.join("\n");
    });
  }

  private webUrl(): string {
    return this.env.WEB_ORIGIN;
  }
}

/**
 * Post a message to a Slack / Discord / Teams incoming webhook. The message is authored once in
 * a neutral markup (`*bold*`, `[label](url)`) and transcoded to each platform's flavour + payload
 * shape here. Best-effort: never throws (a broken webhook must not wedge the dispatcher).
 */
async function postWebhook(kind: ChannelKind, webhookUrl: string, text: string): Promise<boolean> {
  const formatted = formatFor(kind, text);
  // Slack + Teams read `{text}`; Discord reads `{content}` (2000-char cap).
  const body = kind === "discord" ? { content: formatted.slice(0, 1900) } : { text: formatted };
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Transcode the neutral message markup to each platform's flavour. */
function formatFor(kind: ChannelKind, text: string): string {
  if (kind === "slack") {
    // Slack: single-asterisk bold is native; links are <url|label>.
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
  }
  // Discord + Teams use CommonMark: **bold**.
  const bolded = text.replace(/\*([^*]+)\*/g, "**$1**");
  if (kind === "discord") {
    // Discord webhooks don't render [label](url) in content - fall back to "label: url".
    return bolded.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");
  }
  return bolded; // Teams renders [label](url) fine.
}
