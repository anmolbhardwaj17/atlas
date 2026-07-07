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
export interface ChannelStatus {
  configured: boolean;
  kind: "slack" | null;
  enabled: boolean;
  /** Masked hint of the webhook (last segment), never the full URL. */
  hint: string | null;
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

  async getStatus(orgId: string): Promise<ChannelStatus> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<ChannelRow>(
        `SELECT kind, config, enabled, last_alert_at, last_digest_at
           FROM notification_channels LIMIT 1`,
      );
      const ch = rows[0];
      if (!ch) return { configured: false, kind: null, enabled: false, hint: null };
      const url = ch.config.webhookUrl ?? "";
      const tail = url.split("/").pop() ?? "";
      return {
        configured: true,
        kind: ch.kind as "slack",
        enabled: ch.enabled,
        hint: tail ? `…/${tail.slice(0, 6)}…` : null,
      };
    });
  }

  /** Set (or replace) the Slack webhook. Validates it looks like a Slack webhook URL. */
  async setSlack(orgId: string, webhookUrl: string): Promise<ChannelStatus> {
    const url = webhookUrl.trim();
    if (!/^https:\/\/hooks\.slack\.com\/services\/\S+$/.test(url)) {
      throw new ApiException(
        422,
        "validation_failed",
        "That doesn't look like a Slack incoming-webhook URL (https://hooks.slack.com/services/…).",
      );
    }
    await withOrgScope(this.db, orgId, (c) =>
      c.query(
        `INSERT INTO notification_channels (org_id, kind, config, enabled)
         VALUES ($1, 'slack', $2::jsonb, true)
         ON CONFLICT (org_id, kind) DO UPDATE
           SET config = EXCLUDED.config, enabled = true, updated_at = now()`,
        [orgId, JSON.stringify({ webhookUrl: url })],
      ),
    );
    return this.getStatus(orgId);
  }

  async disable(orgId: string): Promise<ChannelStatus> {
    await withOrgScope(this.db, orgId, (c) =>
      c.query(`DELETE FROM notification_channels WHERE kind = 'slack'`),
    );
    return this.getStatus(orgId);
  }

  /** Send a sample message so the user sees it land in their channel. */
  async test(orgId: string): Promise<{ delivered: boolean; message: string }> {
    const url = await this.webhookFor(orgId);
    if (!url)
      throw new ApiException(409, "invalid_state_transition", "No Slack channel configured.");
    const ok = await postSlack(url, {
      text: "👋 *Atlas is connected.* You'll get a heads-up here when something in your estate breaks, gets exposed, or needs attention — plus a short daily digest.",
    });
    return ok
      ? { delivered: true, message: "Sent — check your Slack channel." }
      : { delivered: false, message: "Slack rejected the message. Double-check the webhook URL." };
  }

  private async webhookFor(orgId: string): Promise<string | null> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ config: { webhookUrl?: string } }>(
        `SELECT config FROM notification_channels WHERE kind = 'slack' AND enabled = true LIMIT 1`,
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
    const ch = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<ChannelRow>(
        `SELECT kind, config, enabled, last_alert_at, last_digest_at
           FROM notification_channels WHERE enabled = true LIMIT 1`,
      );
      return rows[0] ?? null;
    });
    const url = ch?.config.webhookUrl;
    if (!ch || !url) return;

    // ── Real-time alerts: health transitions since the watermark ──
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
        [ch.last_alert_at],
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
      // best-effort so a slow/absent model never blocks the alert.
      const broken = alerts.filter((a) => a.to_state !== "healthy").slice(0, 2);
      const diagnoses: string[] = [];
      for (const b of broken) {
        const subject = b.node_name ?? b.node_id;
        const hypothesis = await this.ai.autoDiagnose(orgId, subject).catch(() => null);
        if (hypothesis) diagnoses.push(`\n🤖 *Atlas looked into ${subject}:*\n${hypothesis}`);
      }

      await postSlack(url, {
        text:
          `*Atlas — ${alerts.length} health ${alerts.length === 1 ? "change" : "changes"}*\n` +
          `${lines.join("\n")}` +
          `${diagnoses.join("")}` +
          `\n<${this.webUrl()}/map|Open the map →>`,
      });
      const latest = alerts[alerts.length - 1]?.occurred_at ?? new Date();
      await withOrgScope(this.db, orgId, (c) =>
        c.query(`UPDATE notification_channels SET last_alert_at = $1 WHERE kind = 'slack'`, [
          latest,
        ]),
      );
    }

    // ── Daily digest: once per 24h ──
    const dueForDigest =
      !ch.last_digest_at || Date.now() - ch.last_digest_at.getTime() > 24 * 3_600_000;
    if (dueForDigest) {
      const digest = await this.buildDigest(orgId);
      if (digest) await postSlack(url, { text: digest });
      await withOrgScope(this.db, orgId, (c) =>
        c.query(`UPDATE notification_channels SET last_digest_at = now() WHERE kind = 'slack'`),
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
      parts.push(`<${this.webUrl()}/dashboard|Open your dashboard →>`);
      return parts.join("\n");
    });
  }

  private webUrl(): string {
    return this.env.WEB_ORIGIN;
  }
}

/** POST a Slack message; true on 2xx. Never throws (best-effort delivery). */
async function postSlack(webhookUrl: string, body: { text: string }): Promise<boolean> {
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
