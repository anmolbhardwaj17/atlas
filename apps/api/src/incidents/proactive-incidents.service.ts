import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Env } from "@atlas/config";
import { withOrgScope, type Db } from "@atlas/db";
import { PG_POOL, ENV } from "../core/tokens";
import { EmailService } from "../core/email.service";
import { GraphService } from "../graph/graph.service";
import { inferEnvironment } from "../graph/environment";
import { IncidentsService } from "./incidents.service";
import { AlertPolicyService } from "./alert-policy.service";

/** A health state change the poller detected (mirrors @atlas/ingest HealthTransition). */
export interface HealthChange {
  nodeId: string;
  urn: string;
  from: string | null;
  to: string;
  /** The health_transition event id, so the incident notification dedupes with the generic one. */
  eventId?: string | null;
}

export type Classification =
  "code-change" | "config-change" | "dependency" | "capacity" | "unknown";

interface HeadlineInput {
  events: Array<{ kind: string; occurredAt: string }>;
  now: number;
  unhealthyDeps: Array<{ name: string | null; kind: string }>;
}

const CHANGE_WINDOW_MS = 6 * 60 * 60 * 1000;

function relBefore(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "moments before";
  if (m < 60) return `${m} min before`;
  const h = Math.round(m / 60);
  return `${h}h before`;
}

/**
 * Deterministic likely-cause (NO LLM) — grounded in the graph, cheap, no hallucination risk, so it's
 * safe to run on every qualifying regression and put in an alert. Precedence: a recent deploy/config/PR
 * change (temporal proximity is the strongest signal) → a failing upstream dependency → otherwise
 * capacity/external. The full agentic diagnosis (with the animation) still runs live when a human opens
 * the War Room; this only fills the headline.
 */
export function deterministicHeadline(input: HeadlineInput): {
  classification: Classification;
  summary: string;
} {
  const change = input.events
    .filter((e) => e.kind === "deploy" || e.kind === "config_change" || e.kind === "pr_merged")
    .map((e) => ({ kind: e.kind, t: Date.parse(e.occurredAt) }))
    .filter(
      (e) =>
        !Number.isNaN(e.t) && input.now - e.t <= CHANGE_WINDOW_MS && input.now - e.t >= -60_000,
    )
    .sort((a, b) => b.t - a.t)[0];
  if (change) {
    const ago = relBefore(input.now - change.t);
    if (change.kind === "config_change") {
      return {
        classification: "config-change",
        summary: `A configuration change ${ago} is the most likely cause.`,
      };
    }
    const what = change.kind === "pr_merged" ? "merged PR" : "deploy";
    return { classification: "code-change", summary: `A ${what} ${ago} is the most likely cause.` };
  }
  const dep = input.unhealthyDeps[0];
  if (dep) {
    const more =
      input.unhealthyDeps.length > 1 ? ` (and ${input.unhealthyDeps.length - 1} more)` : "";
    return {
      classification: "dependency",
      summary: `A dependency it relies on — ${dep.name ?? dep.kind}${more} — is also unhealthy.`,
    };
  }
  return {
    classification: "unknown",
    summary:
      "No recent deploy, config change, or failing dependency — likely capacity or an external factor.",
  };
}

/**
 * Proactive incidents (docs/plans/proactive-incidents.md). When a node REGRESSES (healthy → broken)
 * and the org's alert policy + prod gating allow, auto-open a War Room incident, attach a deterministic
 * likely-cause headline, and post a notification. Guardrails: regression-only (baseline for free),
 * policy gate, prod gate, one-per-node dedup, and symptom-suppression (skip if an upstream dependency
 * already has an open incident — the cascade root is the real incident).
 */
@Injectable()
export class ProactiveIncidentsService {
  private readonly logger = new Logger(ProactiveIncidentsService.name);

  private readonly webOrigin: string;

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) env: Env,
    private readonly graph: GraphService,
    private readonly incidents: IncidentsService,
    private readonly policy: AlertPolicyService,
    private readonly email: EmailService,
  ) {
    this.webOrigin = env.WEB_ORIGIN;
  }

  /** Returns true if an incident was opened. Safe to call on every detected transition. */
  async maybeOpenForRegression(orgId: string, change: HealthChange): Promise<boolean> {
    // Regression only: was HEALTHY, now broken. First-sighting (from=null), worsening, and recovery
    // are all skipped → a fresh connect / pre-existing breakage never pages (baseline for free).
    if ((change.to !== "unhealthy" && change.to !== "degraded") || change.from !== "healthy") {
      return false;
    }

    const policy = await this.policy.get(orgId);
    if (policy === "off") return false;

    const node = await this.loadNode(orgId, change.nodeId);
    if (!node) return false;

    const env = inferEnvironment({
      name: node.name,
      urn: change.urn,
      tags: (node.attributes?.tags as Record<string, unknown>) ?? {},
      attributes: node.attributes,
    });
    if (policy === "prod" && env !== "prod") return false;

    // Upstream dependencies (what this relies on) — for symptom-suppression + the dependency headline.
    const deps = await this.graph
      .dependencies(orgId, change.nodeId, { depth: 2, nodeBudget: 100 })
      .catch(() => null);
    const depIds = (deps?.impacted ?? []).map((i) => i.node.id);

    // G3: if an upstream dependency already has an open incident, this is a cascade symptom — don't
    // open a second incident (the root cause is the real one).
    if (depIds.length && (await this.anyOpenIncident(orgId, depIds))) return false;

    const [events, depHealth] = await Promise.all([
      this.graph.nodeEvents(orgId, change.nodeId, 20).catch(() => []),
      this.depHealth(orgId, depIds),
    ]);
    const unhealthyDeps = depHealth.filter(
      (d) => d.health === "unhealthy" || d.health === "degraded",
    );
    const verdict = deterministicHeadline({ events, now: Date.now(), unhealthyDeps });

    const incident = await this.incidents.open(orgId, null, {
      nodeId: change.nodeId,
      trigger: "alert",
    });
    await this.incidents.update(orgId, incident.id, {
      verdict: {
        summary: verdict.summary,
        classification: verdict.classification,
        source: "deterministic",
      },
    });
    await this.notify(orgId, incident.id, node, change.to, verdict.summary, change.eventId ?? null);
    // Email is the "push you'll see when you're not in Atlas". Reserve it for the urgent case
    // (unhealthy, not degraded) so it stays a real page, not noise. Best-effort.
    if (change.to === "unhealthy") {
      await this.emailAlert(orgId, incident.id, node, change.to, verdict.summary).catch((err) =>
        this.logger.warn(`incident email failed: ${(err as Error).message}`),
      );
    }
    this.logger.log(
      `Proactive incident for ${node.name ?? node.kind} (${change.to}): ${verdict.classification}`,
    );
    return true;
  }

  /** Email the org's active members about a new prod incident (best-effort). */
  private async emailAlert(
    orgId: string,
    incidentId: string,
    node: { name: string | null; kind: string },
    state: string,
    cause: string,
  ): Promise<void> {
    const { orgName, recipients } = await withOrgScope(this.db, orgId, async (c) => {
      const org = (
        await c.query<{ name: string }>(
          `SELECT name FROM organizations
            WHERE id = NULLIF(current_setting('atlas.current_org', true), '')::uuid`,
        )
      ).rows[0];
      const rows = (
        await c.query<{ email: string }>(
          `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
            WHERE m.status = 'active' AND u.email IS NOT NULL`,
        )
      ).rows;
      return { orgName: org?.name ?? "your team", recipients: rows.map((r) => r.email) };
    });
    const warRoomUrl = `${this.webOrigin}/war-room/${incidentId}`;
    const label = node.name ?? node.kind;
    for (const to of recipients) {
      await this.email.sendIncidentAlert({
        to,
        orgName,
        nodeName: label,
        state,
        cause,
        warRoomUrl,
      });
    }
  }

  private async loadNode(
    orgId: string,
    nodeId: string,
  ): Promise<{ name: string | null; kind: string; attributes: Record<string, unknown> } | null> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        name: string | null;
        kind: string;
        attributes: Record<string, unknown>;
      }>(`SELECT name, kind, attributes FROM nodes WHERE id = $1 AND deleted_at IS NULL`, [nodeId]);
      return rows[0] ?? null;
    });
  }

  private async anyOpenIncident(orgId: string, nodeIds: string[]): Promise<boolean> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query(
        `SELECT 1 FROM incidents WHERE node_id = ANY($1::uuid[]) AND status IN ('open','analyzing') LIMIT 1`,
        [nodeIds],
      );
      return rows.length > 0;
    });
  }

  private async depHealth(
    orgId: string,
    nodeIds: string[],
  ): Promise<Array<{ name: string | null; kind: string; health: string | null }>> {
    if (nodeIds.length === 0) return [];
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ name: string | null; kind: string; health: string | null }>(
        `SELECT name, kind, attributes->'health'->>'state' AS health
           FROM nodes WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
        [nodeIds],
      );
      return rows;
    });
  }

  private async notify(
    orgId: string,
    incidentId: string,
    node: { name: string | null; kind: string },
    toState: string,
    headline: string,
    eventId: string | null,
  ): Promise<void> {
    const severity = toState === "unhealthy" ? "danger" : "warning";
    const label = node.name ?? node.kind;
    // Share the generic health notification's dedupe key (`health:<eventId>`) so this richer incident
    // notification (likely cause + War Room link) REPLACES it rather than duplicating — whichever
    // inserts first wins, and the poller runs right after the transition, so this one does.
    const dedupe = eventId ? `health:${eventId}` : `incident:${incidentId}`;
    await withOrgScope(this.db, orgId, (c) =>
      c.query(
        `INSERT INTO notifications (org_id, kind, severity, title, body, href, node_kind, dedupe_key)
         VALUES (NULLIF(current_setting('atlas.current_org', true), '')::uuid,
                 'incident', $1, $2, $3, $4, $5, $6)
         ON CONFLICT (org_id, dedupe_key) DO NOTHING`,
        [
          severity,
          `${label} went ${toState}`,
          headline,
          `/war-room/${incidentId}`,
          node.kind,
          dedupe,
        ],
      ),
    );
  }
}
