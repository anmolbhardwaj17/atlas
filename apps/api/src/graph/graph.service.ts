import { Inject, Injectable } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import { architectureProposals as runArchPatterns, type Proposal } from "./architecture-patterns";
import type { PoolClient } from "pg";
import { guidanceFor } from "@atlas/ai";
import { PG_POOL } from "../core/tokens";
import { ApiException } from "../common/errors";
import { TtlCache } from "../common/ttl-cache";
import {
  confidenceRank,
  type CreateEdgeBody,
  decodeCursor,
  encodeCursor,
  IMPACT_EDGE_TYPES,
  rankToConfidence,
  toNodeDto,
  type EdgesQuery,
  type GraphNodeDto,
  type GraphQuery,
  type NeighborsQuery,
  type NodeDto,
  type NodeHealthDto,
  type NodeListQuery,
  type NodeRowish,
  type TimelineQuery,
  type TraversalQuery,
  healthFrom,
} from "./dto";
import { inferEnvironment } from "./environment";

const MAX_DEPTH = 6;
const MAX_NODE_BUDGET = 500;
/** How long a per-org dashboard summary stays cached (see {@link GraphService.summary}). Short
 *  enough that a cross-instance write shows within seconds; long enough to absorb navigation bursts. */
const SUMMARY_TTL_MS = 30_000;

/** Trust ranking for collapsing duplicate edges to their strongest witness (observed ≫ inferred ≫
 *  ai-suggested). Higher wins. Unknown confidence sorts lowest. */
const EDGE_CONFIDENCE_RANK: Record<string, number> = {
  observed: 5,
  "inferred-high": 4,
  "inferred-low": 3,
  inferred: 2,
  "ai-suggested": 1,
};
function edgeConfidenceRank(confidence: string): number {
  return EDGE_CONFIDENCE_RANK[confidence] ?? 0;
}

/**
 * Run `task` over `items` with at most `limit` in flight at once, preserving result order (H5,
 * backend audit Phase C). Each task here opens its own org-scoped pooled connection, so an unbounded
 * `Promise.all` over N items would grab N connections at once — a single finding-detail request could
 * hold 7, and a handful of concurrent requests then starve the pool (max 16) and time out on
 * `pool.connect()`. Capping in-flight tasks bounds a request's connection footprint while keeping most
 * of the parallelism (the work runs in waves of `limit`).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await task(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

const NODE_COLS = `id, urn, kind, name, provider, region, status, confidence, attributes, tags,
  first_seen, last_seen`;

/** Kinds that Explore treats as non-estate (activity + people + per-repo CI sub-resources, plus
 *  dependency-intelligence records - external packages and their vulnerabilities, which number in
 *  the hundreds and belong in Insights/blast-radius, not the estate browser). Hidden from the
 *  default browse list and the Source/Type facet options; an explicit ?kind can still target them
 *  (so finding deep-links like /explore?kind=security.vulnerability keep working). */
const ESTATE_KIND_EXCLUSIONS = `kind NOT LIKE '%.pullrequest' AND kind NOT LIKE '%.pull_request'
  AND kind NOT LIKE '%.user' AND kind NOT LIKE '%.team'
  AND kind NOT LIKE '%.pipeline' AND kind NOT LIKE '%.workflow'
  AND kind <> 'external.package' AND kind <> 'security.vulnerability' AND kind <> 'aws.logs.group'
  AND kind <> 'aws.iam.role'`;

export interface NodeListResult {
  data: NodeDto[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number; total: number };
}

export interface OverviewResult {
  nodeCount: number;
  edgeCount: number;
  byKind: Array<{ kind: string; n: number }>;
  /** Estate facet options for Explore: sources (providers) + semantic categories present. */
  byProvider: Array<{ provider: string; n: number }>;
  byCategory: Array<{ category: string; n: number }>;
  edgesByConfidence: { observed: number; inferredHigh: number; inferredLow: number };
  connections: Array<{ id: string; provider: string; displayName: string; status: string }>;
  lastSyncAt: string | null;
}

export interface EdgeDto {
  id: string;
  type: string;
  origin: string;
  confidence: string;
  status: string;
  from: { id: string; urn: string; kind: string; name: string | null };
  to: { id: string; urn: string; kind: string; name: string | null };
}

/** A graph-derived thing worth a consumer's attention - cited, precision-first (P3/P4). */
export interface Finding {
  id: string;
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  detail: string;
  /** Click-through to the evidence (a node, edge, filtered list, or settings). */
  href: string | null;
  /** Well-Architected pillar (from the shared guidance pack) — drives the category chip. */
  pillar?: string | null;
  count?: number;
  /** The specific affected nodes, when the finding names them — each deep-links to /explore/:id. */
  evidence?: Array<{ id: string; label: string }>;
}

/** One affected resource on the finding-detail page — the raw evidence node enriched with the two
 *  things that let a consumer triage it at a glance: which environment it's in (prod jumps out) and
 *  its current runtime health. */
export interface AffectedResource {
  id: string;
  label: string;
  kind: string;
  environment: string;
  health: NodeHealthDto | null;
}

/** Blast-radius aggregate for the finding-detail "if unfixed, what's affected" band — the union of
 *  what depends on the affected resources (inbound impact), so generic guidance becomes THEIR risk. */
export interface FindingImpact {
  /** Distinct downstream resources that depend on the affected ones (excludes the roots). */
  downstream: number;
  /** A capped sample to render as chips/rows (closest hops first). */
  sample: Array<{ id: string; label: string; kind: string }>;
  truncated: boolean;
}

/** Enriched single-finding view (finding-detail page). The finding itself is assembled by the
 *  controller (adds guidance/lifecycle, same as the list); the service supplies the parts that need
 *  DB access: the affected resources and the blast-radius impact. */
export interface FindingDetail {
  finding: Finding;
  affected: AffectedResource[];
  impact: FindingImpact | null;
  /** Data freshness — findings are derived live, so this sync time is the honest recency signal. */
  lastSyncedAt: string | null;
}

/** Persisted lifecycle of a finding (docs/09): open/resolved + when first/last seen + regression. */
export interface FindingState {
  findingId: string;
  status: "open" | "resolved";
  severity: string;
  title: string;
  category: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  regressedAt: string | null;
}

/** Consumer-facing dashboard summary (docs/09 §5.2): inventory, trust, findings, activity. */
export interface DashboardSummary {
  inventory: {
    resources: number;
    relationships: number;
    // Infrastructure
    services: number;
    datastores: number;
    environments: number;
    clouds: number;
    accounts: number;
    // Code (present when a code host is connected)
    repositories: number;
    projects: number;
    pipelines: number;
    contributors: number;
    pullRequests: number;
  };
  trust: {
    sources: number;
    healthySources: number;
    lastSyncAt: string | null;
  };
  crossBoundary: { crossCloud: number; crossAccount: number };
  findings: Finding[];
  activity: ActivityItem[];
  /** Positive, informational code stats (leaderboards) - present when a code host is connected. */
  insights: {
    topContributors: Array<{ name: string; count: number }>;
    mostActiveRepos: Array<{ name: string; count: number }>;
    pipelineCoverage: { withPipeline: number; total: number };
    posture: {
      security: number;
      reliability: number;
      cost: number;
      performance: number;
      hygiene: number;
      operations: number;
    };
    codeProvider: string | null;
  };
}

/**
 * A human-readable dashboard activity item (docs/09 §5.2). Unlike the raw graph change-feed
 * (`timeline()`), this is node-centric and collapses a PR into ONE "opened in <repo> by <author>"
 * line - it never surfaces internal containment/ownership edges (which read as meaningless
 * "X → Y" rows to a user).
 */
export interface ActivityItem {
  /** Node id for deep-linking to /explore/:id (always present for a real node). */
  id: string | null;
  /** Node kind (e.g. `bitbucket.pullrequest`) so the UI can show the right provider/service logo. */
  kind: string;
  category: "pull_request" | "repository" | "pipeline" | "resource";
  /** The thing itself, e.g. "#42 ROAR-4427" or a resource name. */
  title: string;
  /** Context line, e.g. "gpt-idor-service · Sahil Saleem" (PRs) - null when there's none. */
  subtitle: string | null;
  at: string;
}

/** A directed connection between two map nodes (light - just what the canvas draws). */
export interface GraphEdgeLite {
  id: string;
  from: string;
  to: string;
  type: string;
  origin: string;
  confidence: string;
}
export interface GraphResult {
  nodes: GraphNodeDto[];
  edges: GraphEdgeLite[];
  /** True when the node budget clipped the result (the map shows a banner). */
  truncated: boolean;
}

export interface NodeSummary {
  id: string;
  urn: string;
  kind: string;
  name: string | null;
}
export interface EdgeVia {
  edgeId: string;
  type: string;
  confidence: string;
  evidence: Record<string, unknown>;
  rule: string | null;
  provenanceId: string;
}
export interface EdgeDetail {
  id: string;
  type: string;
  origin: string;
  confidence: string;
  status: string;
  from: NodeSummary;
  to: NodeSummary;
  rule: string | null;
  evidence: Record<string, unknown>;
  provenance: {
    source: string | null;
    observedAt: string | null;
    rawSnapshotId: string | null;
    rawSnapshotRef: string | null;
  };
  firstSeen: string;
  lastSeen: string;
}

/** A pending AI-suggested edge for the review UI (with the model's reasoning). */
export interface SuggestedEdgeDto {
  id: string;
  type: string;
  from: NodeSummary;
  to: NodeSummary;
  reasoning: string | null;
  modelConfidence: string | null;
  createdAt: string;
}
interface SuggestedEdgeRow {
  id: string;
  type: string;
  created_at: Date;
  from_id: string;
  from_urn: string;
  from_kind: string;
  from_name: string | null;
  to_id: string;
  to_urn: string;
  to_kind: string;
  to_name: string | null;
  evidence: unknown;
}

interface EdgeDetailRow {
  id: string;
  type: string;
  origin: string;
  confidence: string;
  status: string;
  first_seen: Date;
  last_seen: Date;
  from_id: string;
  from_urn: string;
  from_kind: string;
  from_name: string | null;
  to_id: string;
  to_urn: string;
  to_kind: string;
  to_name: string | null;
  source: string | null;
  observed_at: Date | null;
  evidence: Record<string, unknown> | null;
  raw_snapshot_id: string | null;
  storage_ref: string | null;
  rule_key: string | null;
  rule_version: number | null;
}

export interface TimelineItem {
  changeKind: "node" | "edge";
  changeType: "created" | "updated";
  at: string;
  entity: Record<string, unknown>;
}

export interface TraversalResult {
  root: NodeSummary;
  impacted: Array<{
    node: NodeSummary;
    /** The node one hop closer to the root on this path — lets the UI draw the real tree edge. */
    parentId: string;
    distance: number;
    via: EdgeVia[];
    pathConfidence: string;
  }>;
  warnings: string[];
  depthUsed: number;
  nodeBudget: number;
  truncated: boolean;
}

/**
 * Graph read API (docs/08 §9). All reads are org-scoped via withOrgScope (RLS enforces;
 * cross-tenant ⇒ empty/404, never leakage - R8). Node list uses keyset pagination over
 * (last_seen desc, id desc), stable under concurrent crawl writes (DD-3).
 */
@Injectable()
export class GraphService {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  // ── Muted / accepted-risk findings (Insights lifecycle) ──────────────────────
  // Findings are derived live from the graph; muting persists a human "accept/dismiss"
  // decision keyed by the stable finding id, so it survives recomputes until unmuted.

  async listMutes(
    orgId: string,
  ): Promise<Array<{ findingId: string; reason: string | null; mutedAt: string }>> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ finding_id: string; reason: string | null; muted_at: Date }>(
        `SELECT finding_id, reason, muted_at FROM muted_findings ORDER BY muted_at DESC`,
      );
      return rows.map((r) => ({
        findingId: r.finding_id,
        reason: r.reason,
        mutedAt: r.muted_at.toISOString(),
      }));
    });
  }

  async muteFinding(
    orgId: string,
    findingId: string,
    reason: string | null,
    userId: string | null,
  ): Promise<void> {
    await withOrgScope(this.db, orgId, (c) =>
      c.query(
        `INSERT INTO muted_findings (org_id, finding_id, reason, muted_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, finding_id) DO UPDATE
           SET reason = EXCLUDED.reason, muted_by = EXCLUDED.muted_by, muted_at = now()`,
        [orgId, findingId, reason, userId],
      ),
    );
    this.summaryCache.invalidate(orgId); // muting hides a finding — reflect it on this instance now
  }

  async unmuteFinding(orgId: string, findingId: string): Promise<void> {
    await withOrgScope(this.db, orgId, (c) =>
      c.query(`DELETE FROM muted_findings WHERE finding_id = $1`, [findingId]),
    );
    this.summaryCache.invalidate(orgId);
  }

  /**
   * Reconcile the persisted finding lifecycle against the live graph. Called by the sync worker
   * after each completed sync (docs/09): findings are derived, so this is the only place the
   * "what's open / what got fixed / what regressed" history is recorded — tied to a real data
   * change, not a page view. Reuses the dashboard's own finding computation, so the persisted
   * lifecycle can never drift from what the UI shows.
   */
  async reconcileFindings(orgId: string): Promise<{ active: number; resolved: number }> {
    // Reconciles the persisted lifecycle against the JUST-synced graph, so it must read fresh, not a
    // possibly-pre-sync cached summary (the worker runs this immediately after a sync completes).
    const { findings } = await this.computeSummary(orgId);
    const activeIds = findings.map((f) => f.id);
    return withOrgScope(this.db, orgId, async (c) => {
      for (const f of findings) {
        await c.query(
          `INSERT INTO finding_state (org_id, finding_id, status, severity, title, category)
           VALUES ($1, $2, 'open', $3, $4, $5)
           ON CONFLICT (org_id, finding_id) DO UPDATE SET
             last_seen_at = now(),
             status       = 'open',
             severity     = EXCLUDED.severity,
             title        = EXCLUDED.title,
             category     = EXCLUDED.category,
             -- resolved → seen again = a regression; stamp it (kept as history).
             regressed_at = CASE WHEN finding_state.status = 'resolved' THEN now()
                                 ELSE finding_state.regressed_at END,
             resolved_at  = NULL`,
          [orgId, f.id, f.severity, f.title, f.category],
        );
      }
      // Anything still open but no longer produced by the live graph is now fixed.
      const resolved = await c.query(
        `UPDATE finding_state SET status = 'resolved', resolved_at = now()
         WHERE status = 'open' AND finding_id <> ALL($1::text[])`,
        [activeIds],
      );
      return { active: activeIds.length, resolved: resolved.rowCount ?? 0 };
    });
  }

  /** The persisted lifecycle rows (open + resolved), for merging aging/fixed history into Insights. */
  async listFindingStates(orgId: string): Promise<FindingState[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        finding_id: string;
        status: "open" | "resolved";
        severity: string;
        title: string;
        category: string;
        first_seen_at: Date;
        last_seen_at: Date;
        resolved_at: Date | null;
        regressed_at: Date | null;
      }>(
        `SELECT finding_id, status, severity, title, category,
                first_seen_at, last_seen_at, resolved_at, regressed_at
           FROM finding_state`,
      );
      return rows.map((r) => ({
        findingId: r.finding_id,
        status: r.status,
        severity: r.severity,
        title: r.title,
        category: r.category,
        firstSeenAt: r.first_seen_at.toISOString(),
        lastSeenAt: r.last_seen_at.toISOString(),
        resolvedAt: r.resolved_at?.toISOString() ?? null,
        regressedAt: r.regressed_at?.toISOString() ?? null,
      }));
    });
  }

  /** Org overview for the dashboard (docs/09 §5.2): counts + tiers + freshness. */
  private async computeOverview(orgId: string): Promise<OverviewResult> {
    return withOrgScope(this.db, orgId, async (c) => {
      const [nodes, kinds, byProvider, byCategory, edges, conns, lastSync] = await Promise.all([
        c.query<{ n: number }>("SELECT count(*)::int AS n FROM nodes WHERE status <> 'deleted'"),
        c.query<{ kind: string; n: number }>(
          `SELECT kind, count(*)::int AS n FROM nodes WHERE status <> 'deleted'
           GROUP BY kind ORDER BY n DESC, kind`,
        ),
        // Estate facet options (exclude activity/people/CI so filters only offer browsable slices).
        c.query<{ provider: string; n: number }>(
          `SELECT provider, count(*)::int AS n FROM nodes
             WHERE status <> 'deleted' AND ${ESTATE_KIND_EXCLUSIONS}
             GROUP BY provider ORDER BY n DESC`,
        ),
        c.query<{ category: string; n: number }>(
          `SELECT nk.category, count(*)::int AS n
             FROM nodes nd JOIN node_kinds nk ON nk.kind = nd.kind
            WHERE nd.status <> 'deleted' AND ${ESTATE_KIND_EXCLUSIONS.replace(/kind/g, "nd.kind")}
            GROUP BY nk.category ORDER BY n DESC`,
        ),
        c.query<{ confidence: string; n: number }>(
          `SELECT confidence, count(*)::int AS n FROM edges WHERE status = 'active'
           GROUP BY confidence`,
        ),
        c.query<{ id: string; provider: string; display_name: string; status: string }>(
          `SELECT id, provider, display_name, status FROM connections
           WHERE deleted_at IS NULL ORDER BY created_at`,
        ),
        c.query<{ ts: Date | null }>(
          "SELECT max(last_synced_at) AS ts FROM connections WHERE deleted_at IS NULL",
        ),
      ]);
      const conf = (t: string): number => edges.rows.find((r) => r.confidence === t)?.n ?? 0;
      return {
        nodeCount: nodes.rows[0]?.n ?? 0,
        edgeCount: edges.rows.reduce((s, r) => s + r.n, 0),
        byKind: kinds.rows,
        byProvider: byProvider.rows,
        byCategory: byCategory.rows.filter((r) => r.category),
        edgesByConfidence: {
          observed: conf("observed"),
          inferredHigh: conf("inferred-high"),
          inferredLow: conf("inferred-low"),
        },
        connections: conns.rows.map((r) => ({
          id: r.id,
          provider: r.provider,
          displayName: r.display_name,
          status: r.status,
        })),
        lastSyncAt: lastSync.rows[0]?.ts?.toISOString() ?? null,
      };
    });
  }

  /**
   * Consumer dashboard summary (docs/09 §5.2). Answers a regular user's real questions -
   * *what do I have, is it trustworthy, what needs attention, what changed* - from the graph
   * itself, not from graph internals. Findings are precision-first + cited (P3/P4): each is a
   * fact the graph proves, with a click-through to its evidence.
   */
  /**
   * The dashboard summary is a heavy read — ~15 full-estate aggregates across four parallel
   * org-scoped connections, all round-tripping to a remote DB. It's hit on every dashboard load and
   * reused by the compliance/insights controllers, and its inputs change only on a sync or a graph
   * mutation. So the result is cached per-org for {@link SUMMARY_TTL_MS} (single-flight: a burst of
   * loads collapses to one DB pass). Staleness is bounded by the TTL; local mutators invalidate their
   * org's entry so a user's own action (mute/connect/edit) reflects immediately on this instance.
   */
  private readonly summaryCache = new TtlCache<DashboardSummary>(SUMMARY_TTL_MS);
  /** `overview()` is a second heavy read (7 full-estate aggregates) hit on every Explore/graph load;
   *  same inputs (change only on sync/mutation) → same short-TTL, self-invalidating cache. */
  private readonly overviewCache = new TtlCache<OverviewResult>(SUMMARY_TTL_MS);

  async summary(orgId: string): Promise<DashboardSummary> {
    return this.summaryCache.get(orgId, () => this.computeSummary(orgId));
  }

  async overview(orgId: string): Promise<OverviewResult> {
    return this.overviewCache.get(orgId, () => this.computeOverview(orgId));
  }

  /** Run an org-scoped write, then drop that org's cached reads so the writer's own change (edge
   *  added/removed/confirmed/rejected) shows on the next dashboard/overview read on this instance. */
  private async mutate<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const r = await withOrgScope(this.db, orgId, fn);
    this.summaryCache.invalidate(orgId);
    this.overviewCache.invalidate(orgId);
    return r;
  }

  private async computeSummary(orgId: string): Promise<DashboardSummary> {
    const impact = [...IMPACT_EDGE_TYPES];
    const now = Date.now();
    // PR insight window: PRs *raised* in the last 30 days (created_on). Captures recent
    // contribution + repo activity (open or merged); a PR opened long ago doesn't count as
    // recent activity. ISO strings sort chronologically → a lexicographic >= is a correct filter.
    const prSince = new Date(now - 30 * 86400 * 1000).toISOString();
    // The human recent-activity window (PR-centric feed) — fetched as a 4th parallel scope below.
    const activitySince = new Date(now - 30 * 24 * 60 * 60 * 1000);
    // Fan the dashboard's independent aggregates across four org-scoped connections. A single
    // pooled client runs queries one-at-a-time (node-postgres serialises on a connection), so ~15
    // sequential round-trips to a remote DB cost seconds; parallel scopes (separate connections)
    // cut wall-time. recentActivity() opens its own scope too, so running it here — instead of
    // sequentially after the fan-out — folds an extra round-trip wave into the same parallel batch.
    // Each scope sets its own atlas.current_org GUC — RLS still enforces isolation (R8).
    const scope = <T>(fn: (c: PoolClient) => Promise<T>): Promise<T> =>
      withOrgScope(this.db, orgId, fn);
    const [grpInventory, grpTopology, grpPeopleVulns, activity] = await Promise.all([
      scope(async (c) => {
        const [cats, total, meta, edgeCount, codeCounts, stale] = await Promise.all([
          c.query<{ category: string; n: number }>(
            `SELECT nk.category, count(*)::int AS n
               FROM nodes nd JOIN node_kinds nk ON nk.kind = nd.kind
              WHERE nd.status <> 'deleted' GROUP BY nk.category`,
          ),
          // True resource total — the `meta` scan below is capped at 5000 for env/cloud inference, so
          // it must NOT be used as the count (an estate >5000 would report exactly 5000).
          c.query<{ n: number }>(`SELECT count(*)::int AS n FROM nodes WHERE status <> 'deleted'`),
          // Bounded sample (LIMIT 5000) — env inference + distinct clouds/accounts only, NOT the count.
          c.query<{
            name: string | null;
            urn: string;
            provider: string;
            account_ref: string | null;
            tags: Record<string, unknown>;
            attributes: Record<string, unknown>;
          }>(
            `SELECT name, urn, provider, account_ref, tags, attributes
               FROM nodes WHERE status <> 'deleted' LIMIT 5000`,
          ),
          c.query<{ n: number }>("SELECT count(*)::int AS n FROM edges WHERE status = 'active'"),
          // Code inventory (repos / projects / pipelines / people / PRs) - makes the dashboard
          // meaningful for a code-heavy org, not just cloud infra.
          c.query<{
            repositories: number;
            projects: number;
            pipelines: number;
            contributors: number;
            pull_requests: number;
          }>(
            `SELECT
               count(*) FILTER (WHERE kind LIKE '%.repository')::int AS repositories,
               count(*) FILTER (WHERE kind LIKE '%.project')::int AS projects,
               count(*) FILTER (WHERE kind LIKE '%.pipeline' OR kind LIKE '%.workflow')::int AS pipelines,
               count(*) FILTER (WHERE kind LIKE '%.user' OR kind LIKE '%.team')::int AS contributors,
               count(*) FILTER (
                 WHERE (kind LIKE '%.pullrequest' OR kind LIKE '%.pull_request')
                   AND (attributes->>'state' IS NULL OR attributes->>'state' = 'OPEN')
               )::int AS pull_requests
             FROM nodes WHERE status <> 'deleted'`,
          ),
          c.query<{ n: number }>("SELECT count(*)::int AS n FROM nodes WHERE status = 'stale'"),
        ]);
        return { cats, total, meta, edgeCount, codeCounts, stale };
      }),
      scope(async (c) => {
        const [
          conns,
          cross,
          blast,
          noPipeline,
          emptyProjects,
          openSgs,
          publicElbs,
          wildcardRoles,
          singleAzDbs,
          unhealthy,
          rootNoMfa,
          publicBuckets,
          unencryptedData,
          noCloudTrail,
        ] = await Promise.all([
          c.query<{
            id: string;
            provider: string;
            display_name: string;
            status: string;
            last_synced_at: Date | null;
          }>(
            `SELECT id, provider, display_name, status, last_synced_at
               FROM connections WHERE deleted_at IS NULL ORDER BY created_at`,
          ),
          // Cross-boundary edges (cloud→cloud spanning a provider or account boundary).
          c.query<{ pf: string; af: string | null; pt: string; at2: string | null }>(
            `SELECT split_part(nf.urn, ':', 1) AS pf, nf.account_ref AS af,
                    split_part(nt.urn, ':', 1) AS pt, nt.account_ref AS at2
               FROM edges e
               JOIN nodes nf ON nf.id = e.from_node_id
               JOIN nodes nt ON nt.id = e.to_node_id
              WHERE e.status = 'active'
                AND split_part(nf.urn, ':', 1) IN ('aws','azure','gcp')
                AND split_part(nt.urn, ':', 1) IN ('aws','azure','gcp')
                AND (split_part(nf.urn, ':', 1) <> split_part(nt.urn, ':', 1)
                     OR (nf.account_ref IS NOT NULL AND nt.account_ref IS NOT NULL
                         AND nf.account_ref <> nt.account_ref))`,
          ),
          // Highest in-degree over impact edges - the biggest single point of failure.
          c.query<{ id: string; name: string | null; kind: string; deg: number }>(
            `SELECT e.to_node_id AS id, nd.name, nd.kind, count(*)::int AS deg
               FROM edges e JOIN nodes nd ON nd.id = e.to_node_id
              WHERE e.status = 'active' AND e.type = ANY($1)
              GROUP BY e.to_node_id, nd.name, nd.kind
              ORDER BY deg DESC LIMIT 1`,
            [impact],
          ),
          // Repos with no CI/CD pipeline (no CONTAINS→pipeline) - a hygiene finding.
          c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM nodes r
              WHERE r.kind LIKE '%.repository' AND r.status <> 'deleted'
                AND NOT EXISTS (
                  SELECT 1 FROM edges e JOIN nodes p ON p.id = e.to_node_id
                   WHERE e.from_node_id = r.id AND e.type = 'CONTAINS'
                     AND (p.kind LIKE '%.pipeline' OR p.kind LIKE '%.workflow'))`,
          ),
          // Projects that contain no repositories.
          c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM nodes pr
              WHERE pr.kind LIKE '%.project' AND pr.status <> 'deleted'
                AND NOT EXISTS (
                  SELECT 1 FROM edges e JOIN nodes r ON r.id = e.to_node_id
                   WHERE e.from_node_id = pr.id AND e.type = 'CONTAINS'
                     AND r.kind LIKE '%.repository')`,
          ),
          // Security posture: SGs open to the internet (0.0.0.0/0 / ::/0) on a SENSITIVE port.
          // A public ALB/VPN on 80/443 is the *intended* front door, not a misconfig — flagging it
          // cries wolf. So we exclude pure single-port web rules (80/443) and keep only non-web or
          // all-ports exposure (SSH/RDP/databases/VPN/custom), which is the real attack surface.
          c.query<{ id: string; name: string | null; ports: string | null }>(
            `SELECT n.id, n.name,
                    string_agg(DISTINCT coalesce(r->>'toPort', 'all'), ', ') AS ports
               FROM signals s
               JOIN nodes n ON n.urn = s.subject_urn AND n.deleted_at IS NULL
               CROSS JOIN LATERAL jsonb_array_elements(s.data->'ingress') AS r
              WHERE s.kind = 'aws.sg.rules'
                AND (r->'cidrs' ? '0.0.0.0/0' OR r->'cidrs' ? '::/0')
                AND (
                  r->>'toPort' IS NULL            -- all ports (protocol -1) → always sensitive
                  OR r->>'toPort' NOT IN ('80', '443')  -- a non-web port
                  OR r->>'fromPort' <> r->>'toPort'     -- a port RANGE (not a pure single web port)
                )
              GROUP BY n.id, n.name`,
          ),
          // Internet-facing load balancers (the estate's front door - worth stating, and a
          // 'private'-named one that is internet-facing is a misconfiguration smell).
          c.query<{ id: string; name: string | null }>(
            `SELECT id, name FROM nodes
              WHERE kind = 'aws.elb' AND deleted_at IS NULL AND status <> 'deleted'
                AND attributes->>'scheme' = 'internet-facing'`,
          ),
          // Wildcard IAM: roles whose policy statements Allow action AND resource '*' - the classic
          // over-broad grant. Trust: EXCLUDE AWS service-linked roles (path /aws-service-role/ or
          // name AWSServiceRoleFor*) - those are AWS-owned, wildcard by design, and not something the
          // customer can (or should) scope down. Only customer-managed roles are actionable.
          c.query<{ id: string; name: string | null }>(
            `SELECT DISTINCT n.id, n.name
               FROM signals s
               JOIN nodes n ON n.urn = s.subject_urn AND n.deleted_at IS NULL
               CROSS JOIN LATERAL jsonb_array_elements(s.data->'statements') AS st
              WHERE s.kind = 'aws.iam.policy_statements'
                AND st->>'effect' = 'Allow'
                AND st->'actions' ? '*'
                AND st->'resources' ? '*'
                AND coalesce(n.attributes->>'path', '') NOT LIKE '/aws-service-role/%'
                AND coalesce(n.name, '') NOT LIKE 'AWSServiceRoleFor%'`,
          ),
          // Single-AZ PRODUCTION databases: one AZ failure takes them down. Trust: a dev/test/staging
          // DB legitimately doesn't need Multi-AZ, so exclude obviously non-prod names (and non-prod
          // env tags) - flagging a scratch DB is noise. The recommendation is for prod data.
          c.query<{ id: string; name: string | null }>(
            `SELECT id, name FROM nodes
              WHERE kind = 'aws.rds.instance' AND deleted_at IS NULL AND status <> 'deleted'
                AND attributes->>'multiAz' = 'false'
                AND coalesce(name, '') !~* '(dev|test|staging|stage|sandbox|sbx|qa|demo|scratch|tmp)'
                AND coalesce(lower(attributes->'tags'->>'environment'), attributes->'tags'->>'env', '')
                    !~* '(dev|test|staging|stage|sandbox|qa|demo)'`,
          ),
          // Runtime health (operational-intelligence Phase B): nodes the health poll marked
          // degraded/unhealthy, worst first - the "something is broken right now" finding.
          c.query<{ id: string; name: string | null; state: string; reason: string | null }>(
            `SELECT id, name, attributes->'health'->>'state' AS state,
                    attributes->'health'->>'reason' AS reason
               FROM nodes
              WHERE status <> 'deleted' AND deleted_at IS NULL
                AND attributes->'health'->>'state' IN ('degraded', 'unhealthy')
              ORDER BY CASE attributes->'health'->>'state' WHEN 'unhealthy' THEN 0 ELSE 1 END
              LIMIT 20`,
          ),
          // Root account without MFA (Security Phase 2b): the classic CIS/critical finding — the
          // root user is unrestricted, so it MUST have MFA. From the aws.account node.
          c.query<{ id: string; name: string | null }>(
            `SELECT id, name FROM nodes
              WHERE kind = 'aws.account' AND deleted_at IS NULL AND status <> 'deleted'
                AND attributes->>'rootMfaEnabled' = 'false'`,
          ),
          // Publicly-accessible S3 buckets (Security Phase 2b). Only KNOWN-public (isPublic='true'),
          // never 'unknown' — no false positive when the posture read was denied.
          c.query<{ id: string; name: string | null }>(
            `SELECT id, name FROM nodes
              WHERE kind = 'aws.s3.bucket' AND deleted_at IS NULL AND status <> 'deleted'
                AND attributes->>'isPublic' = 'true'`,
          ),
          // Datastores not encrypted at rest (Security Phase 2b): RDS StorageEncrypted=false or an
          // S3 bucket with no default encryption. S3 is encrypted by default now, so this is mostly RDS.
          c.query<{ id: string; name: string | null; kind: string }>(
            `SELECT id, name, kind FROM nodes
              WHERE deleted_at IS NULL AND status <> 'deleted'
                AND ((kind = 'aws.rds.instance' AND attributes->>'storageEncrypted' = 'false')
                  OR (kind = 'aws.s3.bucket' AND attributes->>'encrypted' = 'false'))`,
          ),
          // Audit logging: an account with NO multi-region CloudTrail actively logging (Phase 2b).
          // Only fires on known-false (cloudTrailEnabled='false'), never 'unknown' (null) → no
          // false-fire when the read was denied.
          c.query<{ id: string; name: string | null }>(
            `SELECT id, name FROM nodes
              WHERE kind = 'aws.account' AND deleted_at IS NULL AND status <> 'deleted'
                AND attributes->>'cloudTrailEnabled' = 'false'`,
          ),
        ]);
        return {
          conns,
          cross,
          blast,
          noPipeline,
          emptyProjects,
          openSgs,
          publicElbs,
          wildcardRoles,
          singleAzDbs,
          unhealthy,
          rootNoMfa,
          publicBuckets,
          unencryptedData,
          noCloudTrail,
        };
      }),
      scope(async (c) => {
        const [contributors, mostActiveRepos, vulnSeverity, topVulnPkg, sprawl, exposedVulns] =
          await Promise.all([
            // Top contributors by PRs raised (open + merged) in the last 90 days.
            c.query<{ name: string | null; n: number }>(
              `SELECT u.name, count(*)::int AS n
               FROM edges e
               JOIN nodes pr ON pr.id = e.from_node_id AND pr.kind LIKE '%.pullrequest'
                 AND pr.attributes->>'createdOn' >= $1
               JOIN nodes u ON u.id = e.to_node_id AND (u.kind LIKE '%.user' OR u.kind LIKE '%.team')
              WHERE e.type = 'OWNED_BY' AND e.status = 'active'
              GROUP BY u.name ORDER BY n DESC, u.name LIMIT 5`,
              [prSince],
            ),
            // Most active repositories by PRs raised (open + merged) in the last 90 days.
            c.query<{ name: string | null; n: number }>(
              `SELECT r.name, count(*)::int AS n
               FROM edges e
               JOIN nodes r ON r.id = e.from_node_id AND r.kind LIKE '%.repository'
               JOIN nodes pr ON pr.id = e.to_node_id AND pr.kind LIKE '%.pullrequest'
                 AND pr.attributes->>'createdOn' >= $1
              WHERE e.type = 'CONTAINS' AND e.status = 'active'
              GROUP BY r.name ORDER BY n DESC, r.name LIMIT 5`,
              [prSince],
            ),
            // ── Dependency intelligence (docs/plans/security-vulnerabilities.md) ──────
            // Known vulnerabilities by severity + how many distinct packages they hit.
            c.query<{ severity: string | null; vulns: number; packages: number }>(
              `SELECT v.attributes->>'severity' AS severity,
                    count(DISTINCT v.id)::int AS vulns,
                    count(DISTINCT a.to_node_id)::int AS packages
               FROM nodes v
               JOIN edges a ON a.from_node_id = v.id AND a.type = 'AFFECTS' AND a.status = 'active'
              WHERE v.kind = 'security.vulnerability' AND v.status <> 'deleted'
              GROUP BY v.attributes->>'severity'`,
            ),
            // Blast radius: the vulnerable package used by the most repositories - one upgrade,
            // many repos fixed. `worst_rank` is the highest severity among the vulns affecting it.
            c.query<{
              id: string;
              name: string | null;
              ecosystem: string | null;
              vulns: number;
              repos: number;
              worst_rank: number;
            }>(
              `SELECT pkg.id, pkg.name, pkg.attributes->>'ecosystem' AS ecosystem,
                    count(DISTINCT v.id)::int AS vulns,
                    count(DISTINCT dep.from_node_id)::int AS repos,
                    min(CASE v.attributes->>'severity'
                          WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                          WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END) AS worst_rank
               FROM nodes pkg
               JOIN edges a ON a.to_node_id = pkg.id AND a.type = 'AFFECTS' AND a.status = 'active'
               JOIN nodes v ON v.id = a.from_node_id AND v.kind = 'security.vulnerability'
               LEFT JOIN edges dep ON dep.to_node_id = pkg.id
                     AND dep.type = 'DEPENDS_ON_PKG' AND dep.status = 'active'
              WHERE pkg.kind = 'external.package' AND pkg.status <> 'deleted'
              GROUP BY pkg.id, pkg.name, pkg.attributes->>'ecosystem'
              ORDER BY repos DESC, vulns DESC LIMIT 1`,
            ),
            // Dependency sprawl: one package pinned to many different versions across repos - an
            // inconsistency + a harder single upgrade path. The per-repo version lives in the
            // DEPENDS_ON_PKG edge's provenance evidence (edges carry no attributes column, docs/05).
            c.query<{ id: string; name: string | null; versions: number; repos: number }>(
              `SELECT pkg.id, pkg.name,
                    count(DISTINCT pv.evidence->>'version')::int AS versions,
                    count(DISTINCT dep.from_node_id)::int AS repos
               FROM nodes pkg
               JOIN edges dep ON dep.to_node_id = pkg.id
                     AND dep.type = 'DEPENDS_ON_PKG' AND dep.status = 'active'
               JOIN provenance pv ON pv.id = dep.provenance_id
              WHERE pkg.kind = 'external.package' AND pkg.status <> 'deleted'
                AND pv.evidence->>'version' IS NOT NULL
              GROUP BY pkg.id, pkg.name
             HAVING count(DISTINCT pv.evidence->>'version') >= 3
              ORDER BY versions DESC LIMIT 1`,
            ),
            // ── The toxic combination (Phase 2): internet-EXPOSED resources running known-
            // vulnerable code. Walk the whole chain — EXPOSED_VIA(resource) ← DEPLOYS_TO(repo) →
            // DEPENDS_ON_PKG(pkg) ← AFFECTS(vuln) — keeping only critical/high vulns. One row per
            // exposed, vulnerable runtime, worst severity first. This is the finding that matters
            // (reachable > buried), the payoff of holding code + cloud + exposure in one graph.
            c.query<{
              id: string;
              name: string | null;
              kind: string;
              vulns: number;
              worst_rank: number;
              sample_vuln: string | null;
              sample_pkg: string | null;
              via: string | null;
            }>(
              `SELECT rt.id, rt.name, rt.kind,
                      count(DISTINCT v.id)::int AS vulns,
                      min(CASE v.attributes->>'severity'
                            WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                            WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END) AS worst_rank,
                      (array_agg(v.attributes->>'osvId' ORDER BY
                          CASE v.attributes->>'severity' WHEN 'critical' THEN 0 WHEN 'high' THEN 1
                               WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END))[1] AS sample_vuln,
                      (array_agg(pkg.name))[1] AS sample_pkg,
                      (array_agg(ev_prov.evidence->>'via'))[1] AS via
                 FROM nodes rt
                 JOIN edges ev ON ev.from_node_id = rt.id AND ev.type = 'EXPOSED_VIA'
                       AND ev.status = 'active'
                 LEFT JOIN provenance ev_prov ON ev_prov.id = ev.provenance_id
                 JOIN edges dt ON dt.to_node_id = rt.id AND dt.type = 'DEPLOYS_TO'
                       AND dt.status = 'active'
                 JOIN edges dep ON dep.from_node_id = dt.from_node_id
                       AND dep.type = 'DEPENDS_ON_PKG' AND dep.status = 'active'
                 JOIN nodes pkg ON pkg.id = dep.to_node_id AND pkg.kind = 'external.package'
                 JOIN edges a ON a.to_node_id = pkg.id AND a.type = 'AFFECTS' AND a.status = 'active'
                 JOIN nodes v ON v.id = a.from_node_id AND v.kind = 'security.vulnerability'
                WHERE rt.status <> 'deleted' AND rt.deleted_at IS NULL
                  AND v.attributes->>'severity' IN ('critical', 'high')
                GROUP BY rt.id, rt.name, rt.kind
                ORDER BY worst_rank, vulns DESC LIMIT 20`,
            ),
          ]);
        return { contributors, mostActiveRepos, vulnSeverity, topVulnPkg, sprawl, exposedVulns };
      }),
      // 4th parallel scope: the human PR-centric activity feed (was a sequential round-trip).
      this.recentActivity(orgId, activitySince, 6),
    ]);

    const { cats, total, meta, edgeCount, codeCounts, stale } = grpInventory;
    const {
      conns,
      cross,
      blast,
      noPipeline,
      emptyProjects,
      openSgs,
      publicElbs,
      wildcardRoles,
      singleAzDbs,
      unhealthy,
      rootNoMfa,
      publicBuckets,
      unencryptedData,
      noCloudTrail,
    } = grpTopology;
    const { contributors, mostActiveRepos, vulnSeverity, topVulnPkg, sprawl, exposedVulns } =
      grpPeopleVulns;

    const base = (() => {
      const code = codeCounts.rows[0];
      const catN = (names: string[]): number =>
        cats.rows.filter((r) => names.includes(r.category)).reduce((s, r) => s + r.n, 0);

      const envs = new Set<string>();
      const clouds = new Set<string>();
      const accounts = new Set<string>();
      for (const m of meta.rows) {
        envs.add(
          inferEnvironment({ name: m.name, urn: m.urn, tags: m.tags, attributes: m.attributes }),
        );
        // Cloud is derived from the URN prefix (the canonical identity, robust vs the
        // provider column) - consistent with the map's `providerOf`.
        const cloud = m.urn.split(":")[0] ?? "";
        if (["aws", "azure", "gcp"].includes(cloud)) clouds.add(cloud);
        if (m.account_ref) accounts.add(m.account_ref);
      }

      let crossCloud = 0;
      let crossAccount = 0;
      for (const r of cross.rows) {
        if (r.pf !== r.pt) crossCloud += 1;
        else if (r.af && r.at2 && r.af !== r.at2) crossAccount += 1;
      }

      return {
        resources: total.rows[0]?.n ?? 0,
        relationships: edgeCount.rows[0]?.n ?? 0,
        services: catN(["compute"]),
        datastores: catN(["data", "storage"]),
        environments: envs.size,
        clouds: clouds.size,
        accounts: accounts.size,
        repositories: code?.repositories ?? 0,
        projects: code?.projects ?? 0,
        pipelines: code?.pipelines ?? 0,
        contributors: code?.contributors ?? 0,
        pullRequests: code?.pull_requests ?? 0,
        conns: conns.rows,
        crossCloud,
        crossAccount,
        blast: blast.rows[0] ?? null,
        stale: stale.rows[0]?.n ?? 0,
        noPipeline: noPipeline.rows[0]?.n ?? 0,
        emptyProjects: emptyProjects.rows[0]?.n ?? 0,
        unhealthyNodes: unhealthy.rows,
        openSgs: openSgs.rows,
        publicElbs: publicElbs.rows,
        wildcardRoles: wildcardRoles.rows,
        singleAzDbs: singleAzDbs.rows,
        rootNoMfa: rootNoMfa.rows,
        publicBuckets: publicBuckets.rows,
        unencryptedData: unencryptedData.rows,
        noCloudTrail: noCloudTrail.rows,
        topContributors: contributors.rows.map((r) => ({ name: r.name ?? "unknown", count: r.n })),
        mostActiveRepos: mostActiveRepos.rows.map((r) => ({
          name: r.name ?? "unknown",
          count: r.n,
        })),
        vulnSeverity: vulnSeverity.rows,
        topVulnPkg: topVulnPkg.rows[0] ?? null,
        sprawl: sprawl.rows[0] ?? null,
        exposedVulns: exposedVulns.rows,
      };
    })();

    // ── Findings (severity-ranked, cited) ──────────────────────────────────────
    const findings: Finding[] = [];
    // ── The toxic combination (Phase 2): exposed AND vulnerable — the headline security finding ──
    const exposedVulns2 = base.exposedVulns ?? [];
    if (exposedVulns2.length > 0) {
      const viaLabel = (v: string | null): string =>
        v === "world-open-sg"
          ? "a world-open security group"
          : v === "internet-facing-lb"
            ? "an internet-facing load balancer"
            : "the internet";
      findings.push({
        id: "exposed-vulnerable",
        severity: "high",
        category: "Reachable vulnerability",
        title: `${exposedVulns2.length} internet-exposed ${exposedVulns2.length > 1 ? "resources are" : "resource is"} running known-vulnerable code`,
        detail: exposedVulns2
          .map(
            (r) =>
              `${r.name ?? r.id}${r.sample_pkg ? ` (${r.sample_pkg}${r.sample_vuln ? ` · ${r.sample_vuln}` : ""})` : ""} - reachable via ${viaLabel(r.via)}`,
          )
          .join("; "),
        // Click-through to the map with the Exposed lens on — the exposed resources lit, the rest
        // dimmed (the per-resource + blast-radius drill-down lives on the /insights/[id] detail page).
        href: `/map?lens=exposed`,
        count: exposedVulns2.length,
        evidence: exposedVulns2.map((r) => ({
          id: r.id,
          label: `${r.name ?? r.id} · ${r.vulns} ${r.vulns === 1 ? "CVE" : "CVEs"}`,
        })),
      });
    }
    // ── Security posture (Phase E, first slice) ──
    const openSgs2 = base.openSgs ?? [];
    if (openSgs2.length > 0) {
      const first = openSgs2[0];
      findings.push({
        id: "sg-world-open",
        severity: "high",
        category: "Security posture",
        title: `${openSgs2.length} security group${openSgs2.length > 1 ? "s expose" : " exposes"} a sensitive port to the whole internet (0.0.0.0/0)`,
        detail: openSgs2
          .map((g) => `${g.name ?? g.id}${g.ports ? ` (port ${g.ports})` : ""}`)
          .join("; "),
        href: first ? `/explore/${first.id}` : "/explore?kind=aws.securitygroup",
        count: openSgs2.length,
        evidence: openSgs2.map((g) => ({
          id: g.id,
          label: `${g.name ?? g.id}${g.ports ? ` (port ${g.ports})` : ""}`,
        })),
      });
    }
    const misnamed = (base.publicElbs ?? []).filter((l) => /private|internal/i.test(l.name ?? ""));
    if (misnamed.length > 0) {
      const first = misnamed[0];
      findings.push({
        id: "elb-private-but-public",
        severity: "high",
        category: "Security posture",
        title: `${misnamed.length} load balancer${misnamed.length > 1 ? "s are" : " is"} named private/internal but internet-facing`,
        detail: `${misnamed.map((l) => l.name).join(", ")} - the scheme says internet-facing; either the name or the exposure is wrong.`,
        href: first ? `/explore/${first.id}` : "/explore?kind=aws.elb",
        count: misnamed.length,
        evidence: misnamed.map((l) => ({ id: l.id, label: l.name ?? l.id })),
      });
    }

    const wild = base.wildcardRoles ?? [];
    if (wild.length > 0) {
      findings.push({
        id: "iam-wildcard",
        severity: "high",
        category: "Security posture",
        title: `${wild.length} IAM role${wild.length > 1 ? "s have" : " has"} a wildcard Allow (action * on resource *)`,
        detail: `${wild
          .slice(0, 5)
          .map((r) => r.name ?? r.id)
          .join(
            ", ",
          )}${wild.length > 5 ? ` (+${wild.length - 5} more)` : ""} - a compromise of anything assuming these roles is a compromise of the whole account.`,
        href: "/explore?kind=aws.iam.role",
        count: wild.length,
        evidence: wild.map((r) => ({ id: r.id, label: r.name ?? r.id })),
      });
    }
    const singleAz = base.singleAzDbs ?? [];
    if (singleAz.length > 0) {
      const first = singleAz[0];
      findings.push({
        id: "rds-single-az",
        severity: "medium",
        category: "Security posture",
        title: `${singleAz.length} database${singleAz.length > 1 ? "s run" : " runs"} in a single availability zone`,
        detail: `${singleAz.map((d) => d.name ?? d.id).join(", ")} - one AZ outage takes ${singleAz.length > 1 ? "them" : "it"} down; enable Multi-AZ for production data.`,
        href: first ? `/explore/${first.id}` : "/explore?kind=aws.rds.instance",
        count: singleAz.length,
        evidence: singleAz.map((d) => ({ id: d.id, label: d.name ?? d.id })),
      });
    }
    // Root account without MFA (Security Phase 2b) - critical: the root user is unrestricted.
    const rootNoMfa2 = base.rootNoMfa ?? [];
    if (rootNoMfa2.length > 0) {
      const first = rootNoMfa2[0];
      findings.push({
        id: "root-no-mfa",
        severity: "high",
        category: "Security posture",
        title: `AWS root account has no MFA`,
        detail: `${rootNoMfa2.map((a) => a.name ?? a.id).join(", ")} - the root user can do anything and can't be scoped; enable a hardware/virtual MFA device on it immediately.`,
        href: first ? `/explore/${first.id}` : "/explore?kind=aws.account",
        count: rootNoMfa2.length,
        evidence: rootNoMfa2.map((a) => ({ id: a.id, label: a.name ?? a.id })),
      });
    }
    // Publicly-accessible S3 buckets (Security Phase 2b) - a classic data-exposure incident.
    const publicS3 = base.publicBuckets ?? [];
    if (publicS3.length > 0) {
      const first = publicS3[0];
      findings.push({
        id: "s3-public",
        severity: "high",
        category: "Security posture",
        title: `${publicS3.length} S3 bucket${publicS3.length > 1 ? "s are" : " is"} publicly accessible`,
        detail: `${publicS3.map((b) => b.name ?? b.id).join(", ")} - reachable from the public internet via ACL or bucket policy; enable Block Public Access unless this is a deliberate public asset.`,
        href: first ? `/explore/${first.id}` : "/explore?kind=aws.s3.bucket",
        count: publicS3.length,
        evidence: publicS3.map((b) => ({ id: b.id, label: b.name ?? b.id })),
      });
    }
    // Datastores unencrypted at rest (Security Phase 2b).
    const unencrypted = base.unencryptedData ?? [];
    if (unencrypted.length > 0) {
      const first = unencrypted[0];
      findings.push({
        id: "unencrypted-datastore",
        severity: "high",
        category: "Security posture",
        title: `${unencrypted.length} datastore${unencrypted.length > 1 ? "s are" : " is"} not encrypted at rest`,
        detail: `${unencrypted.map((d) => d.name ?? d.id).join(", ")} - enable encryption at rest (KMS); for existing resources, snapshot-and-restore into an encrypted copy.`,
        href: first ? `/explore/${first.id}` : "/explore",
        count: unencrypted.length,
        evidence: unencrypted.map((d) => ({ id: d.id, label: d.name ?? d.id })),
      });
    }
    // No multi-region CloudTrail actively logging (Security Phase 2b) - no audit trail of API activity.
    const noCt = base.noCloudTrail ?? [];
    if (noCt.length > 0) {
      const first = noCt[0];
      findings.push({
        id: "no-cloudtrail",
        severity: "medium",
        category: "Security posture",
        title: `No multi-region CloudTrail is actively logging`,
        detail: `${noCt.map((a) => a.name ?? a.id).join(", ")} - without an account-wide audit trail you can't investigate an incident or prove what happened; enable a multi-region CloudTrail with log-file validation.`,
        href: first ? `/explore/${first.id}` : "/explore?kind=aws.account",
        count: noCt.length,
        evidence: noCt.map((a) => ({ id: a.id, label: a.name ?? a.id })),
      });
    }

    // ── Runtime health (operational-intelligence Phase B) - broken-right-now outranks hygiene ──
    const unhealthyNodes = base.unhealthyNodes ?? [];
    const brokenCount = unhealthyNodes.filter((n) => n.state === "unhealthy").length;
    if (unhealthyNodes.length > 0) {
      const worst = unhealthyNodes[0];
      findings.push({
        id: "service-health",
        severity: brokenCount > 0 ? "high" : "medium",
        category: "Service health",
        title:
          brokenCount > 0
            ? `${brokenCount} resource${brokenCount > 1 ? "s are" : " is"} unhealthy right now`
            : `${unhealthyNodes.length} resource${unhealthyNodes.length > 1 ? "s are" : " is"} degraded right now`,
        detail: worst
          ? `${worst.name ?? "A resource"}: ${worst.reason ?? worst.state}${unhealthyNodes.length > 1 ? ` (+${unhealthyNodes.length - 1} more)` : ""}`
          : "",
        href: worst ? `/explore/${worst.id}` : "/map",
        count: unhealthyNodes.length,
        evidence: unhealthyNodes.map((n) => ({
          id: n.id,
          label: `${n.name ?? n.id} - ${n.reason ?? n.state}`,
        })),
      });
    }
    const STALE_MS = 7 * 24 * 60 * 60 * 1000;
    for (const conn of base.conns) {
      if (conn.status === "error") {
        findings.push({
          id: `source-error-${conn.id}`,
          severity: "high",
          category: "Source health",
          title: `${conn.display_name} failed to sync`,
          detail: "This source errored - its slice of your graph may be out of date.",
          href: "/settings",
        });
      } else if (conn.status === "degraded") {
        findings.push({
          id: `source-degraded-${conn.id}`,
          severity: "medium",
          category: "Source health",
          title: `${conn.display_name} is degraded`,
          detail: "The last sync was partial - some resources may be missing.",
          href: "/settings",
        });
      } else if (
        conn.status === "connected" &&
        conn.last_synced_at &&
        now - conn.last_synced_at.getTime() > STALE_MS
      ) {
        findings.push({
          id: `source-stale-${conn.id}`,
          severity: "low",
          category: "Source health",
          title: `${conn.display_name} hasn't synced in a while`,
          detail: "Its data is older than 7 days - the graph here may have drifted.",
          href: "/settings",
        });
      }
    }
    const crossTotal = base.crossCloud + base.crossAccount;
    if (crossTotal > 0) {
      findings.push({
        id: "cross-boundary",
        severity: "medium",
        category: "Cross-boundary",
        title: `${crossTotal} connection${crossTotal > 1 ? "s" : ""} span a cloud or account boundary`,
        detail:
          "A resource depends on a datastore in another cloud or account - a wider blast radius (and likely egress cost).",
        href: "/map",
        count: crossTotal,
      });
    }
    if (base.blast && base.blast.deg >= 3) {
      findings.push({
        id: `blast-${base.blast.id}`,
        severity: base.blast.deg >= 6 ? "medium" : "low",
        category: "Blast radius",
        title: `${base.blast.name ?? base.blast.kind} is a single point of failure`,
        detail: `${base.blast.deg} resources depend on it directly - if it fails, they're affected.`,
        href: `/explore/${base.blast.id}/impact`,
        count: base.blast.deg,
      });
    }
    if (base.stale > 0) {
      findings.push({
        id: "stale-resources",
        severity: "low",
        category: "Freshness",
        title: `${base.stale} resource${base.stale > 1 ? "s" : ""} went stale`,
        detail: "Not seen in the latest sync - they may have been removed.",
        href: "/explore?status=stale",
        count: base.stale,
      });
    }
    if (base.noPipeline > 0) {
      findings.push({
        id: "repos-no-pipeline",
        severity: "low",
        category: "Code hygiene",
        title: `${base.noPipeline} repositor${base.noPipeline > 1 ? "ies have" : "y has"} no CI/CD pipeline`,
        detail: "No deployment pipeline was found - these repos may ship manually or not at all.",
        href: "/explore?kind=bitbucket.repository",
        count: base.noPipeline,
      });
    }
    if (base.emptyProjects > 0) {
      findings.push({
        id: "empty-projects",
        severity: "low",
        category: "Code hygiene",
        title: `${base.emptyProjects} project${base.emptyProjects > 1 ? "s contain" : " contains"} no repositories`,
        detail: "An empty project - likely archived, or a placeholder that can be cleaned up.",
        href: "/explore?kind=bitbucket.project",
        count: base.emptyProjects,
      });
    }
    // ── Dependency intelligence findings (docs/plans/security-vulnerabilities.md) ──
    // Vulnerabilities in dependencies, ranked by real impact: severity + blast radius.
    const sevCount = (s: string): number =>
      base.vulnSeverity
        .filter((r) => (r.severity ?? "unknown") === s)
        .reduce((n, r) => n + r.vulns, 0);
    const critical = sevCount("critical");
    const high = sevCount("high");
    const medium = sevCount("medium");
    const totalVulns = base.vulnSeverity.reduce((n, r) => n + r.vulns, 0);
    const affectedPkgs = base.vulnSeverity.reduce((n, r) => n + r.packages, 0);
    if (totalVulns > 0) {
      const serious = critical + high;
      findings.push({
        id: "vulnerabilities",
        severity: serious > 0 ? "high" : medium > 0 ? "medium" : "low",
        category: "Vulnerabilities",
        title: `${totalVulns} known ${totalVulns > 1 ? "vulnerabilities" : "vulnerability"} in your dependencies`,
        detail:
          serious > 0
            ? `${serious} high-severity across ${affectedPkgs} package${affectedPkgs > 1 ? "s" : ""}. Upgrade to a patched version to close them.`
            : `Across ${affectedPkgs} package${affectedPkgs > 1 ? "s" : ""}. Upgrade to a patched version to close them.`,
        href: "/explore?kind=security.vulnerability",
        count: totalVulns,
      });
    }
    // Blast radius: a vulnerable package many repos depend on - one upgrade fixes them all.
    const vp = base.topVulnPkg;
    const SEV_BY_RANK = ["critical", "high", "medium", "low", "unknown"];
    if (vp && vp.repos >= 2) {
      const worst = SEV_BY_RANK[vp.worst_rank] ?? "unknown";
      findings.push({
        id: `vuln-blast-${vp.id}`,
        severity: vp.worst_rank <= 1 ? "high" : vp.worst_rank === 2 ? "medium" : "low",
        category: "Blast radius",
        title: `${vp.name} is vulnerable and used by ${vp.repos} repositories`,
        detail: `A ${worst}-severity dependency with wide blast radius - a single upgrade fixes all ${vp.repos} repos at once.`,
        href: `/explore/${vp.id}/impact`,
        count: vp.repos,
      });
    }
    // Dependency sprawl: the same package pinned to many versions across the estate.
    const sp = base.sprawl;
    if (sp) {
      findings.push({
        id: `sprawl-${sp.id}`,
        severity: "low",
        category: "Dependency sprawl",
        title: `${sp.name} is pinned to ${sp.versions} different versions`,
        detail: `${sp.repos} repos use ${sp.versions} versions of the same package - inconsistent, and a harder single upgrade path.`,
        href: `/explore/${sp.id}`,
        count: sp.versions,
      });
    }

    const rank = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

    // Tag each finding with its Well-Architected pillar from the shared guidance pack, so the
    // dashboard's category chip is the SAME dynamic pillar the Insights page shows.
    for (const f of findings) f.pillar = guidanceFor(f.category)?.pillar ?? null;

    // ── Posture by pillar (AWS Well-Architected axes) ──────────────────────────
    // Each pillar starts at 100 (all clear) and is pulled down by its findings, weighted by
    // severity. A radar of these shows *where* the estate is weak, not just the overall score.
    const posture = {
      security: 100,
      reliability: 100,
      cost: 100,
      performance: 100,
      hygiene: 100,
      operations: 100,
    };
    const pillarPenalty = { high: 22, medium: 10, low: 4 };
    for (const f of findings) {
      const pillar = guidanceFor(f.category)?.pillar as keyof typeof posture | undefined;
      if (pillar && pillar in posture) {
        posture[pillar] = Math.max(0, posture[pillar] - pillarPenalty[f.severity]);
      }
    }

    // Recent activity (human, PR-centric) was fetched in the parallel fan-out above (`activity`).
    const lastSyncAt = base.conns
      .map((c) => c.last_synced_at)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      inventory: {
        resources: base.resources,
        relationships: base.relationships,
        services: base.services,
        datastores: base.datastores,
        environments: base.environments,
        clouds: base.clouds,
        accounts: base.accounts,
        repositories: base.repositories,
        projects: base.projects,
        pipelines: base.pipelines,
        contributors: base.contributors,
        pullRequests: base.pullRequests,
      },
      trust: {
        sources: base.conns.length,
        healthySources: base.conns.filter((c) => c.status === "connected").length,
        lastSyncAt: lastSyncAt?.toISOString() ?? null,
      },
      crossBoundary: { crossCloud: base.crossCloud, crossAccount: base.crossAccount },
      insights: {
        topContributors: base.topContributors,
        mostActiveRepos: base.mostActiveRepos,
        pipelineCoverage: {
          withPipeline: Math.max(0, base.repositories - base.noPipeline),
          total: base.repositories,
        },
        posture,
        // Which code host the PR/repo leaderboards come from, so the UI can brand them
        // dynamically (Bitbucket today, GitHub/GitLab when connected) instead of hardcoding.
        codeProvider:
          base.conns.find((c) => ["github", "bitbucket", "gitlab"].includes(c.provider))
            ?.provider ?? null,
      },
      findings,
      activity,
    };
  }

  /**
   * Whole-graph fetch for the visual map (docs/09 §5.4): bounded nodes + the edges among
   * them, each node carrying its (derived) environment + account for grouping. SQL filters
   * kind/region/account; environment is inferred in-process (not a column) so it's filtered
   * after. Node-budgeted - `truncated` tells the UI to show a "showing N of many" banner.
   */
  /**
   * Cloud-infrastructure breakdown for the AI estate snapshot (per-kind counts, freshest
   * example names, live not-healthy counts). Without this, "tell me about my AWS infra"
   * could only cite `clouds=1` - the inventory existed in the graph but never reached the
   * model. Org-scoped (RLS).
   */
  async infrastructureBreakdown(
    orgId: string,
  ): Promise<Array<{ kind: string; count: number; names: string[]; notHealthy: number }>> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        kind: string;
        count: number;
        names: string[] | null;
        not_healthy: number;
      }>(
        `SELECT kind, count(*)::int AS count,
                (array_agg(coalesce(name, urn) ORDER BY last_seen DESC))[1:5] AS names,
                count(*) FILTER (
                  WHERE attributes->'health'->>'state' IN ('degraded', 'unhealthy')
                )::int AS not_healthy
           FROM nodes
          WHERE status <> 'deleted' AND deleted_at IS NULL
            AND (kind LIKE 'aws.%' OR kind LIKE 'azure.%' OR kind LIKE 'gcp.%')
            AND kind <> 'aws.logs.group' AND kind <> 'aws.iam.role'
          GROUP BY kind
          ORDER BY count DESC`,
      );
      return rows.map((r) => ({
        kind: r.kind,
        count: r.count,
        names: r.names ?? [],
        notHealthy: r.not_healthy,
      }));
    });
  }

  /**
   * Change timeline for one node (operational-intelligence Phase C): persisted
   * node_events (CloudTrail config changes, health transitions, deploys) UNION derived
   * pr_merged entries for repositories (merged PRs are already graph nodes - no backfill
   * table needed for history the graph itself proves). Newest first. 404 via loadNode.
   */
  async nodeEvents(
    orgId: string,
    id: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      kind: string;
      occurredAt: string;
      actor: string | null;
      title: string;
      source: string;
      evidence: Record<string, unknown>;
    }>
  > {
    return withOrgScope(this.db, orgId, async (c) => {
      const node = await this.loadNode(c, id);
      const { rows } = await c.query<{
        id: string;
        kind: string;
        occurred_at: Date;
        actor: string | null;
        title: string;
        source: string;
        evidence: Record<string, unknown>;
      }>(
        `SELECT id, kind, occurred_at, actor, title, source, evidence
           FROM node_events WHERE node_id = $1
          ORDER BY occurred_at DESC LIMIT $2`,
        [id, limit],
      );
      const events = rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        occurredAt: r.occurred_at.toISOString(),
        actor: r.actor,
        title: r.title,
        source: r.source,
        evidence: r.evidence,
      }));

      if (node.kind.endsWith(".repository")) {
        const prs = await c.query<{
          id: string;
          name: string | null;
          author: string | null;
          merged_on: string | null;
        }>(
          `SELECT p.id, p.name,
                  (SELECT nu.name FROM edges eo
                     JOIN nodes nu ON nu.id = eo.to_node_id
                    WHERE eo.from_node_id = p.id AND eo.type = 'OWNED_BY' LIMIT 1) AS author,
                  p.attributes->>'updatedOn' AS merged_on
             FROM edges e JOIN nodes p ON p.id = e.to_node_id
            WHERE e.from_node_id = $1 AND e.type = 'CONTAINS'
              AND p.kind LIKE '%.pullrequest'
              AND p.attributes->>'state' = 'MERGED'
            ORDER BY p.attributes->>'updatedOn' DESC NULLS LAST
            LIMIT $2`,
          [id, limit],
        );
        for (const pr of prs.rows) {
          if (!pr.merged_on) continue;
          events.push({
            id: pr.id,
            kind: "pr_merged",
            occurredAt: pr.merged_on,
            actor: pr.author,
            title: `PR merged: ${pr.name ?? pr.id}${pr.author ? ` (by ${pr.author})` : ""}`,
            source: "graph",
            evidence: { prNodeId: pr.id },
          });
        }
        events.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
      }
      return events.slice(0, limit);
    });
  }

  async graph(orgId: string, q: GraphQuery): Promise<GraphResult> {
    return withOrgScope(this.db, orgId, async (c) => {
      const where = ["status <> 'deleted'"];
      // The map shows current infrastructure + in-flight work: open PRs only. Merged/declined
      // PRs are history (hundreds of them) and just clutter the canvas.
      where.push(
        `((kind NOT LIKE '%.pullrequest' AND kind NOT LIKE '%.pull_request')
           OR attributes->>'state' = 'OPEN')`,
      );
      // External packages + their vulnerabilities are dependency-intelligence supporting data
      // (hundreds of nodes) - they'd swamp the estate map (and, being freshly synced, sort to the
      // top). Keep the canvas about infrastructure + code; an explicit ?kind can still target them.
      if (!q.kind) {
        where.push(
          `kind <> 'external.package' AND kind <> 'security.vulnerability' AND kind <> 'aws.logs.group' AND kind <> 'aws.iam.role' AND kind <> 'aws.account'`,
        );
      }
      const params: unknown[] = [];
      const p = (v: unknown): string => `$${params.push(v)}`;
      if (q.kind) where.push(`kind = ${p(q.kind)}`);
      if (q.region) where.push(`region = ${p(q.region)}`);
      if (q.account) where.push(`account_ref = ${p(q.account)}`);

      // Over-fetch a little so env filtering + the budget still yield a full map.
      const hardCap = Math.min(q.limit * 2, 1000);
      const nodeRows = (
        await c.query<NodeRowish & { account_ref: string | null }>(
          `SELECT ${NODE_COLS}, account_ref FROM nodes
           WHERE ${where.join(" AND ")}
           ORDER BY last_seen DESC, id DESC
           LIMIT ${hardCap + 1}`,
          params,
        )
      ).rows;

      let mapped: GraphNodeDto[] = nodeRows.map((r) => ({
        ...toNodeDto(r),
        environment: inferEnvironment({
          name: r.name,
          urn: r.urn,
          tags: r.tags,
          attributes: r.attributes,
        }),
        accountRef: r.account_ref,
        health: healthFrom(r.attributes),
      }));
      if (q.environment) mapped = mapped.filter((n) => n.environment === q.environment);

      const truncated = mapped.length > q.limit;
      // Primary budget: the most-recently-seen nodes up to the limit.
      const budget = mapped.slice(0, q.limit);
      const budgetIds = budget.map((n) => n.id);

      // Edges touching the budget (AT LEAST one endpoint visible), not only edges fully inside it.
      // The last_seen cut can strand a repo just past the budget while its runtime stays — an
      // observed DEPLOYS_TO edge would then be dropped and the repo would fall into the "no infra
      // link" shelf, a *false* unlinked. We pull the missing endpoint back into view (below) so a
      // repo and its runtime are never split by a display budget (P3/P4: never hide a real link).
      const touchingEdges =
        budgetIds.length === 0
          ? []
          : (
              await c.query<{
                id: string;
                from_node_id: string;
                to_node_id: string;
                type: string;
                origin: string;
                confidence: string;
              }>(
                `SELECT id, from_node_id, to_node_id, type, origin, confidence FROM edges
                 WHERE status = 'active'
                   AND (from_node_id = ANY($1::uuid[]) OR to_node_id = ANY($1::uuid[]))`,
                [budgetIds],
              )
            ).rows;

      // Frontier: endpoints of budget-touching edges that fell just outside the budget but are still
      // in the over-fetched set. The pull is naturally bounded — a frontier node MUST be in `mapped`
      // (the top `hardCap+1` by last_seen), so the whole map is at most `hardCap+1` nodes and a hub
      // can't explode the canvas. We must NOT cut this short at `hardCap`: a budget node's real
      // neighbours would then be split off (a repo stranded from its runtime — the exact "false
      // unlinked" this frontier exists to prevent, P3/P4: never hide a real link). Endpoints beyond
      // the over-fetch (or an excluded kind — packages/IAM/logs) aren't in `mapped`, so their edge is
      // left to drop, preserving the "no dangling endpoint" guarantee.
      const inView = new Set(budgetIds);
      const byIdMapped = new Map(mapped.map((n) => [n.id, n] as const));
      const frontier: GraphNodeDto[] = [];
      for (const e of touchingEdges) {
        for (const endpoint of [e.from_node_id, e.to_node_id]) {
          if (inView.has(endpoint)) continue;
          const node = byIdMapped.get(endpoint);
          if (!node) continue;
          inView.add(endpoint);
          frontier.push(node);
        }
      }

      // Slim the shipped attributes to scalars only. The canvas RENDERS nothing else — keyFacts
      // skips objects/arrays and the CloudWatch deep-link reads specific scalar keys — while a raw
      // resource's JSONB can carry nested policy documents, subnet/SG lists and tag maps that are
      // pure payload here (env + health are already derived server-side into their own fields). This
      // materially trims /graph on config-heavy estates without changing anything the map can show.
      const slim = (n: GraphNodeDto): GraphNodeDto => ({
        ...n,
        attributes: mapScalarAttributes(n.attributes),
      });
      const nodes = (frontier.length ? [...budget, ...frontier] : budget).map(slim);
      // Collapse duplicate edges to ONE per (from,to,type) at the highest confidence. `uq_edge`
      // includes `inference_rule_id`, so several rules (e.g. R1 name-match + R12/R17 SHA-match) each
      // persist their own DEPLOYS_TO row for the same pair — correct for provenance, but the map must
      // show a single cited edge at its strongest tier, not the same arrow twice at conflicting
      // confidence (P3 — one high-confidence edge, not a high AND a low).
      const bestByPair = new Map<string, (typeof touchingEdges)[number]>();
      for (const e of touchingEdges) {
        if (!(inView.has(e.from_node_id) && inView.has(e.to_node_id))) continue;
        const key = `${e.from_node_id}|${e.to_node_id}|${e.type}`;
        const prev = bestByPair.get(key);
        if (!prev || edgeConfidenceRank(e.confidence) > edgeConfidenceRank(prev.confidence)) {
          bestByPair.set(key, e);
        }
      }
      const edges = [...bestByPair.values()].map((e) => ({
        id: e.id,
        from: e.from_node_id,
        to: e.to_node_id,
        type: e.type,
        origin: e.origin,
        confidence: e.confidence,
      }));

      return { nodes, edges, truncated };
    });
  }

  async listNodes(orgId: string, q: NodeListQuery): Promise<NodeListResult> {
    return withOrgScope(this.db, orgId, async (c) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const p = (v: unknown): string => `$${params.push(v)}`;

      // `$1 IN ($2,$3,…)` for a multi-value facet (OR within the facet).
      const inList = (col: string, vals: string[]): string =>
        `${col} IN (${vals.map((v) => p(v)).join(", ")})`;

      where.push(q.status ? inList("status", q.status) : `status <> 'deleted'`);
      if (q.kind) {
        where.push(`kind = ${p(q.kind)}`);
      } else {
        // Explore browses the top-level estate - the *things* you have: repos, services,
        // datastores, cloud resources. Not activity (PRs), people (users/teams), or per-repo CI
        // sub-resources. An explicit ?kind can still target those.
        where.push(ESTATE_KIND_EXCLUSIONS);
      }
      // Product facets: filter by source (connection provider) and/or semantic category. Both
      // multi-value. They compose with the estate exclusions above, so `category=code` still shows
      // only repos/projects (PRs/users/pipelines stay hidden).
      if (q.source) where.push(inList("provider", q.source));
      if (q.category)
        where.push(`kind IN (SELECT kind FROM node_kinds WHERE ${inList("category", q.category)})`);
      if (q.region) where.push(`region = ${p(q.region)}`);
      if (q.confidence) where.push(`confidence = ${p(q.confidence)}`);
      // Runtime-health facet: attributes.health.state. 'unknown' = the key is absent (never checked)
      // — a designed state, not a failure (docs/09 §7). Multi-value: OR the requested states, with
      // 'unknown' matching an absent health key.
      if (q.health) {
        const states = q.health.filter((h) => h !== "unknown");
        const parts: string[] = [];
        if (states.length > 0) parts.push(inList(`attributes->'health'->>'state'`, states));
        if (q.health.includes("unknown")) {
          parts.push(`(attributes->'health' IS NULL OR attributes->'health'->>'state' IS NULL)`);
        }
        if (parts.length > 0) where.push(`(${parts.join(" OR ")})`);
      }
      if (q.q) where.push(`name ILIKE ${p(`%${q.q}%`)}`);

      // The filter set that defines the result population (everything except the keyset cursor) —
      // shared by the COUNT (for a true "N resources" total) and the page query.
      const baseWhere = where.join(" AND ");
      const { rows: countRows } = await c.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM nodes WHERE ${baseWhere}`,
        params,
      );
      const total = Number(countRows[0]?.total ?? 0);

      if (q.cursor) {
        const cur = decodeCursor(q.cursor);
        where.push(
          `(last_seen < ${p(cur.lastSeen)} OR (last_seen = ${p(cur.lastSeen)} AND id < ${p(cur.id)}))`,
        );
      }

      const { rows } = await c.query<NodeRowish>(
        `SELECT ${NODE_COLS} FROM nodes WHERE ${where.join(" AND ")}
         ORDER BY last_seen DESC, id DESC LIMIT ${q.limit + 1}`,
        params,
      );
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map(toNodeDto),
        page: {
          nextCursor:
            hasMore && last
              ? encodeCursor({ lastSeen: last.last_seen.toISOString(), id: last.id })
              : null,
          hasMore,
          limit: q.limit,
          total,
        },
      };
    });
  }

  async getNode(
    orgId: string,
    id: string,
  ): Promise<NodeDto & { provenance: unknown; environment: string }> {
    if (!UUID_RE.test(id)) throw ApiException.notFound();
    return withOrgScope(this.db, orgId, async (c) => {
      // The node + its latest raw snapshot/provenance in ONE round-trip (was two sequential
      // queries on the same connection). A LEFT JOIN LATERAL picks the freshest snapshot per node;
      // the provenance confidence is aliased so it can't collide with the node's own `confidence`.
      const { rows } = await c.query<
        NodeRowish & {
          source: string | null;
          sync_run_id: string | null;
          observed_at: Date | null;
          prov_confidence: string | null;
          raw_snapshot_id: string | null;
          storage_ref: string | null;
        }
      >(
        `SELECT ${NODE_COLS},
                pr.source, pr.sync_run_id, pr.observed_at, pr.prov_confidence,
                pr.raw_snapshot_id, pr.storage_ref
           FROM nodes
           LEFT JOIN LATERAL (
             SELECT p.source, p.sync_run_id, p.observed_at, p.confidence AS prov_confidence,
                    rs.id AS raw_snapshot_id, rs.storage_ref
               FROM raw_snapshots rs
               LEFT JOIN provenance p ON p.raw_snapshot_id = rs.id
              WHERE rs.node_id = nodes.id
              ORDER BY rs.captured_at DESC LIMIT 1
           ) pr ON true
          WHERE nodes.id = $1`,
        [id],
      );
      const node = rows[0];
      if (!node) throw ApiException.notFound();
      const hasProv = node.raw_snapshot_id != null || node.source != null;
      return {
        ...toNodeDto(node),
        environment: inferEnvironment({
          name: node.name,
          urn: node.urn,
          tags: node.tags,
          attributes: node.attributes,
        }),
        provenance: hasProv
          ? {
              source: node.source,
              syncRunId: node.sync_run_id,
              observedAt: node.observed_at?.toISOString() ?? null,
              confidence: node.prov_confidence,
              rawSnapshotId: node.raw_snapshot_id,
              rawSnapshotRef: node.storage_ref,
            }
          : null,
      };
    });
  }

  /** Findings from the authoritative dashboard computation that name THIS node — powers the Risks
   *  section on the node detail. Reuses summary() so there's no second, drifting rule set (a finding
   *  shown here is exactly one you'd see in Insights). Matches by evidence node id or an /explore
   *  deep-link to this node. */
  async findingsForNode(orgId: string, id: string): Promise<Finding[]> {
    const { findings } = await this.summary(orgId);
    const href = `/explore/${id}`;
    return findings.filter(
      (f) =>
        f.href === href ||
        f.href === `/explore/${id}/impact` ||
        (f.evidence?.some((e) => e.id === id) ?? false),
    );
  }

  /** Enriched single-finding view for the detail page: the live finding + its affected resources
   *  (env/health, so prod/unhealthy sort first) + a bounded blast-radius impact ("what depends on
   *  the affected resources"). Reuses summary() so it never drifts from Insights; returns null when
   *  the finding has cleared since the list was drawn (the page then shows the auto-resolved state). */
  /**
   * Architecture Advisor (docs/plans/optimization.md): grounded structural-improvement proposals,
   * each with a before/after subgraph. Reads the compute / datastore / load-balancer nodes + their
   * edges once and runs the pure pattern library. Read-only — the proposed graph is a
   * recommendation the UI clearly labels, never asserted as observed truth (P3/P4).
   */
  async architectureProposals(orgId: string): Promise<Proposal[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      const nodeRows = (
        await c.query<{
          id: string;
          urn: string;
          kind: string;
          name: string;
          attributes: Record<string, unknown>;
        }>(
          `SELECT id, urn, kind, name, attributes FROM nodes
             WHERE status <> 'deleted' AND kind = ANY($1::text[])`,
          [["aws.rds.instance", "aws.ec2.instance", "aws.elb"]],
        )
      ).rows;
      if (nodeRows.length === 0) return [];
      const ids = nodeRows.map((r) => r.id);
      const edges = (
        await c.query<{ from_node_id: string; to_node_id: string; type: string }>(
          `SELECT from_node_id, to_node_id, type FROM edges
             WHERE status = 'active'
               AND (from_node_id = ANY($1::uuid[]) OR to_node_id = ANY($1::uuid[]))`,
          [ids],
        )
      ).rows.map((e) => ({ from: e.from_node_id, to: e.to_node_id, type: e.type }));
      // Dependents = inbound dependency-bearing edges (who points AT this node).
      const DEP_TYPES = new Set(["CONNECTS_TO", "STORES_IN", "DEPENDS_ON", "ROUTES_TO"]);
      const depCount = new Map<string, number>();
      for (const e of edges) {
        if (DEP_TYPES.has(e.type)) depCount.set(e.to, (depCount.get(e.to) ?? 0) + 1);
      }
      return runArchPatterns(nodeRows, edges, (id) => depCount.get(id) ?? 0);
    });
  }

  async findingDetail(orgId: string, id: string): Promise<FindingDetail | null> {
    const s = await this.summary(orgId);
    const finding = s.findings.find((f) => f.id === id);
    if (!finding) return null;
    const lastSyncedAt = s.trust.lastSyncAt;

    const evidenceIds = (finding.evidence ?? []).map((e) => e.id).filter((x) => UUID_RE.test(x));
    if (evidenceIds.length === 0) return { finding, affected: [], impact: null, lastSyncedAt };

    // The affected-node enrichment and the per-root blast-radius traversals are all independent and
    // each open their own scope (separate pooled connection). Run them concurrently rather than
    // sequentially — this endpoint previously opened up to 7 scopes back-to-back (1 affected + 6
    // blast-radius), each a full round-trip cluster to a remote DB. The blast-radius roots are
    // concurrency-capped (H5) so this whole request holds at most 1 + IMPACT_FANOUT connections,
    // leaving the pool headroom for other requests instead of one detail load starving it.
    const IMPACT_ROOTS = 6;
    const IMPACT_FANOUT = 3;
    const roots = evidenceIds.slice(0, IMPACT_ROOTS);
    const [affected, blasts] = await Promise.all([
      // Enrich the affected nodes with environment + runtime health (one batched lookup).
      withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<NodeRowish>(
          `SELECT ${NODE_COLS} FROM nodes WHERE id = ANY($1::uuid[])`,
          [evidenceIds],
        );
        const byId = new Map(rows.map((r) => [r.id, r]));
        // Preserve the finding's evidence order, then float prod + unhealthy to the top.
        const list = evidenceIds
          .map((nid): AffectedResource | null => {
            const r = byId.get(nid);
            if (!r) return null;
            return {
              id: r.id,
              label: r.name ?? r.urn ?? r.id,
              kind: r.kind,
              environment: inferEnvironment({
                name: r.name,
                urn: r.urn,
                tags: r.tags,
                attributes: r.attributes,
              }),
              health: healthFrom(r.attributes),
            };
          })
          .filter((x): x is AffectedResource => x !== null);
        const healthRank = (h: NodeHealthDto | null): number =>
          h?.state === "unhealthy" ? 0 : h?.state === "degraded" ? 1 : 2;
        return list.sort(
          (a, b) =>
            (a.environment === "prod" ? 0 : 1) - (b.environment === "prod" ? 0 : 1) ||
            healthRank(a.health) - healthRank(b.health),
        );
      }),
      // Impact — the inbound blast-radius of each affected root ("what breaks if these fail").
      // Bounded (a few roots, shallow, small budget) so the detail page stays fast; capped at
      // IMPACT_FANOUT concurrent traversals so the request's connection footprint stays bounded (H5).
      mapWithConcurrency(roots, IMPACT_FANOUT, (rootId) =>
        this.blastRadius(orgId, rootId, { depth: 3, nodeBudget: 100 }),
      ),
    ]);

    // Union the per-root traversals. P3: if nothing depends on them, we show no impact band.
    const rootSet = new Set(evidenceIds);
    const impacted = new Map<string, FindingImpact["sample"][number]>();
    let truncated = false;
    for (const t of blasts) {
      truncated = truncated || t.truncated;
      for (const im of t.impacted) {
        if (rootSet.has(im.node.id) || impacted.has(im.node.id)) continue;
        impacted.set(im.node.id, {
          id: im.node.id,
          label: im.node.name ?? im.node.urn,
          kind: im.node.kind,
        });
      }
    }
    const impact: FindingImpact | null =
      impacted.size > 0
        ? { downstream: impacted.size, sample: [...impacted.values()].slice(0, 8), truncated }
        : null;

    return { finding, affected, impact, lastSyncedAt };
  }

  async nodeEdges(orgId: string, id: string, q: EdgesQuery): Promise<EdgeDto[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      await this.loadNode(c, id); // 404 if absent / cross-tenant
      const params: unknown[] = [id];
      const p = (v: unknown): string => `$${params.push(v)}`;
      const dir =
        q.direction === "in"
          ? "e.to_node_id = $1"
          : q.direction === "out"
            ? "e.from_node_id = $1"
            : "(e.from_node_id = $1 OR e.to_node_id = $1)";
      const extra: string[] = [`e.status = 'active'`];
      if (q.type) extra.push(`e.type = ${p(q.type)}`);
      if (q.confidence) extra.push(`e.confidence = ${p(q.confidence)}`);

      const { rows } = await c.query<EdgeRow>(
        `SELECT e.id, e.type, e.origin, e.confidence, e.status,
                nf.id AS from_id, nf.urn AS from_urn, nf.kind AS from_kind, nf.name AS from_name,
                nt.id AS to_id, nt.urn AS to_urn, nt.kind AS to_kind, nt.name AS to_name
           FROM edges e
           JOIN nodes nf ON nf.id = e.from_node_id
           JOIN nodes nt ON nt.id = e.to_node_id
          WHERE ${dir} AND ${extra.join(" AND ")}
          ORDER BY e.type LIMIT ${q.limit}`,
        params,
      );
      return rows.map(toEdgeDto);
    });
  }

  async nodeNeighbors(
    orgId: string,
    id: string,
    q: NeighborsQuery,
  ): Promise<{ nodes: NodeDto[]; edges: EdgeDto[] }> {
    return withOrgScope(this.db, orgId, async (c) => {
      const root = await this.loadNode(c, id);
      const { rows: edgeRows } = await c.query<EdgeRow>(
        `SELECT e.id, e.type, e.origin, e.confidence, e.status,
                nf.id AS from_id, nf.urn AS from_urn, nf.kind AS from_kind, nf.name AS from_name,
                nt.id AS to_id, nt.urn AS to_urn, nt.kind AS to_kind, nt.name AS to_name
           FROM edges e
           JOIN nodes nf ON nf.id = e.from_node_id
           JOIN nodes nt ON nt.id = e.to_node_id
          WHERE (e.from_node_id = $1 OR e.to_node_id = $1) AND e.status = 'active'
          LIMIT $2`,
        [id, q.nodeBudget],
      );
      const edges = edgeRows.map(toEdgeDto);
      const neighborIds = new Set<string>();
      for (const e of edges) {
        if (e.from.id !== id) neighborIds.add(e.from.id);
        if (e.to.id !== id) neighborIds.add(e.to.id);
      }
      const neighbors =
        neighborIds.size > 0
          ? (
              await c.query<NodeRowish>(
                `SELECT ${NODE_COLS} FROM nodes WHERE id = ANY($1::uuid[])`,
                [[...neighborIds]],
              )
            ).rows.map(toNodeDto)
          : [];
      return { nodes: [toNodeDto(root), ...neighbors], edges };
    });
  }

  /** Inbound impact closure - "what breaks if this is deleted" (US-4, docs/08 §9). */
  async blastRadius(orgId: string, id: string, q: TraversalQuery): Promise<TraversalResult> {
    return this.traverse(orgId, id, "inbound", q);
  }
  /** Outbound dependency closure - "what this depends on" (US-9). */
  async dependencies(orgId: string, id: string, q: TraversalQuery): Promise<TraversalResult> {
    return this.traverse(orgId, id, "outbound", q);
  }

  /** Edge detail: evidence, rule, provenance + raw-snapshot link (docs/08 §9). */
  async getEdge(orgId: string, id: string): Promise<EdgeDetail> {
    return withOrgScope(this.db, orgId, async (c) => {
      if (!UUID_RE.test(id)) throw ApiException.notFound();
      const { rows } = await c.query<EdgeDetailRow>(
        `SELECT e.id, e.type, e.origin, e.confidence, e.status,
                e.first_seen, e.last_seen,
                nf.id AS from_id, nf.urn AS from_urn, nf.kind AS from_kind, nf.name AS from_name,
                nt.id AS to_id, nt.urn AS to_urn, nt.kind AS to_kind, nt.name AS to_name,
                p.source, p.observed_at, p.evidence, p.raw_snapshot_id,
                rs.storage_ref, ir.key AS rule_key, ir.version AS rule_version
           FROM edges e
           JOIN nodes nf ON nf.id = e.from_node_id
           JOIN nodes nt ON nt.id = e.to_node_id
           LEFT JOIN provenance p ON p.id = e.provenance_id
           LEFT JOIN raw_snapshots rs ON rs.id = p.raw_snapshot_id
           LEFT JOIN inference_rules ir ON ir.id = e.inference_rule_id
          WHERE e.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) throw ApiException.notFound();
      return {
        id: r.id,
        type: r.type,
        origin: r.origin,
        confidence: r.confidence,
        status: r.status,
        from: { id: r.from_id, urn: r.from_urn, kind: r.from_kind, name: r.from_name },
        to: { id: r.to_id, urn: r.to_urn, kind: r.to_kind, name: r.to_name },
        rule: r.rule_key ? `${r.rule_key}@${r.rule_version}` : null,
        evidence: r.evidence ?? {},
        provenance: {
          source: r.source,
          observedAt: r.observed_at?.toISOString() ?? null,
          rawSnapshotId: r.raw_snapshot_id,
          rawSnapshotRef: r.storage_ref,
        },
        firstSeen: r.first_seen.toISOString(),
        lastSeen: r.last_seen.toISOString(),
      };
    });
  }

  // ── AI-suggested edges (docs/05 §6, docs/10) ──────────────────────────────
  /** Pending AI edge suggestions for review, newest first, with the model's reasoning (P4). */
  async listSuggestedEdges(orgId: string): Promise<SuggestedEdgeDto[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<SuggestedEdgeRow>(
        `SELECT e.id, e.type, e.created_at,
                nf.id AS from_id, nf.urn AS from_urn, nf.kind AS from_kind, nf.name AS from_name,
                nt.id AS to_id, nt.urn AS to_urn, nt.kind AS to_kind, nt.name AS to_name,
                p.evidence
           FROM edges e
           JOIN nodes nf ON nf.id = e.from_node_id
           JOIN nodes nt ON nt.id = e.to_node_id
           LEFT JOIN provenance p ON p.id = e.provenance_id
          WHERE e.origin = 'ai_suggested' AND e.status = 'active'
          ORDER BY e.created_at DESC`,
      );
      return rows.map((r) => {
        const ev = (r.evidence ?? {}) as { reasoning?: unknown; modelConfidence?: unknown };
        return {
          id: r.id,
          type: r.type,
          from: { id: r.from_id, urn: r.from_urn, kind: r.from_kind, name: r.from_name },
          to: { id: r.to_id, urn: r.to_urn, kind: r.to_kind, name: r.to_name },
          reasoning: typeof ev.reasoning === "string" ? ev.reasoning : null,
          modelConfidence: typeof ev.modelConfidence === "string" ? ev.modelConfidence : null,
          createdAt: r.created_at.toISOString(),
        };
      });
    });
  }

  /** Confirm an AI-suggested edge → `origin='confirmed'` (human-vouched, protected from the
   *  inference retire pass, promoted to inferred-high). 404 if not a live ai_suggested edge. */
  async confirmSuggestedEdge(orgId: string, id: string): Promise<{ ok: true }> {
    return this.mutate(orgId, async (c) => {
      if (!UUID_RE.test(id)) throw ApiException.notFound();
      const { rowCount } = await c.query(
        `UPDATE edges SET origin = 'confirmed', confidence = 'inferred-high', updated_at = now()
          WHERE id = $1 AND origin = 'ai_suggested' AND status = 'active'`,
        [id],
      );
      if (!rowCount) throw ApiException.notFound();
      return { ok: true };
    });
  }

  /** Reject an AI-suggested edge → delete it AND remember the pair so it's never re-proposed. */
  async rejectSuggestedEdge(
    orgId: string,
    id: string,
    userId: string | null,
  ): Promise<{ ok: true }> {
    return this.mutate(orgId, async (c) => {
      if (!UUID_RE.test(id)) throw ApiException.notFound();
      const { rows } = await c.query<{ from_node_id: string; to_node_id: string; type: string }>(
        `SELECT from_node_id, to_node_id, type FROM edges
          WHERE id = $1 AND origin = 'ai_suggested' AND status = 'active'`,
        [id],
      );
      const e = rows[0];
      if (!e) throw ApiException.notFound();
      await c.query(
        `INSERT INTO edge_suggestion_rejections (org_id, from_node_id, to_node_id, type, rejected_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, from_node_id, to_node_id, type) DO NOTHING`,
        [orgId, e.from_node_id, e.to_node_id, e.type, userId],
      );
      await c.query(`DELETE FROM edges WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  /**
   * Create a MANUAL edge (docs/05) — a human hand-drawing a link the connectors/inference missed
   * (e.g. wiring a bottom-shelf repo to the service it deploys to). `origin='manual'`,
   * `confidence='observed'` (a person vouched), provenance-backed (source='manual', by=userId). If
   * the pair was previously rejected, adding it now clears that "no". Idempotent: an already-active
   * link returns as-is (its origin is left untouched); a retired same-(from,to,type) row is revived.
   */
  async createManualEdge(
    orgId: string,
    body: CreateEdgeBody,
    userId: string | null,
  ): Promise<{ ok: true; id: string }> {
    return this.mutate(orgId, async (c) => {
      if (body.fromId === body.toId) {
        throw ApiException.invalidState("A link can't start and end at the same resource.");
      }
      // Both endpoints must be live nodes in THIS org (RLS scopes; a cross-tenant id → 404).
      const nodes = await c.query(
        `SELECT id FROM nodes WHERE id = ANY($1::uuid[]) AND status <> 'deleted'`,
        [[body.fromId, body.toId]],
      );
      if (nodes.rowCount !== 2) throw ApiException.notFound();

      // Already linked? Respect the existing edge (keep its observed/inferred origin) — success, no-op.
      const active = await c.query<{ id: string }>(
        `SELECT id FROM edges
          WHERE from_node_id = $1 AND to_node_id = $2 AND type = $3 AND status = 'active' LIMIT 1`,
        [body.fromId, body.toId, body.type],
      );
      if (active.rows[0]) return { ok: true, id: active.rows[0].id };

      // Changed their mind about a pair they'd rejected → forget the "no".
      await c.query(
        `DELETE FROM edge_suggestion_rejections WHERE from_node_id = $1 AND to_node_id = $2 AND type = $3`,
        [body.fromId, body.toId, body.type],
      );
      const prov = await c.query<{ id: string }>(
        `INSERT INTO provenance (org_id, source, confidence, evidence)
         VALUES ($1, 'manual', 'observed', $2) RETURNING id`,
        [orgId, JSON.stringify({ by: userId })],
      );
      // Revive-on-conflict: uq_edge includes inference_rule_id (NULL here), so a RETIRED same-key row
      // (an old observed/manual edge) is re-activated AS manual — the human now vouches for it.
      const ins = await c.query<{ id: string }>(
        `INSERT INTO edges
           (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, last_seen)
         VALUES ($1, $2, $3, $4, 'manual', 'observed', $5, now())
         ON CONFLICT ON CONSTRAINT uq_edge DO UPDATE
           SET status = 'active', origin = 'manual', confidence = 'observed',
               provenance_id = EXCLUDED.provenance_id, retired_at = NULL, last_seen = now()
         RETURNING id`,
        [orgId, body.fromId, body.toId, body.type, prov.rows[0]?.id],
      );
      const id = ins.rows[0]?.id;
      if (!id) throw ApiException.invalidState("Could not create the link.");
      return { ok: true, id };
    });
  }

  /**
   * Remove an edge the user says is wrong ("fix the flow"). Retires it (soft — history kept) and
   * remembers the pair in `edge_suggestion_rejections` so inference / AI-suggestion never re-adds
   * it. OBSERVED edges are refused: they're ground truth from a connector (a re-sync would just
   * re-add them), so the fix belongs at the source. 404 on an unknown/already-gone edge.
   */
  async removeEdge(orgId: string, id: string, userId: string | null): Promise<{ ok: true }> {
    return this.mutate(orgId, async (c) => {
      if (!UUID_RE.test(id)) throw ApiException.notFound();
      const { rows } = await c.query<{
        from_node_id: string;
        to_node_id: string;
        type: string;
        origin: string;
      }>(
        `SELECT from_node_id, to_node_id, type, origin FROM edges WHERE id = $1 AND status = 'active'`,
        [id],
      );
      const e = rows[0];
      if (!e) throw ApiException.notFound();
      if (e.origin === "observed") {
        throw ApiException.invalidState(
          "This link is observed directly from the source, so it can't be removed here — fix it at the source.",
        );
      }
      await c.query(
        `INSERT INTO edge_suggestion_rejections (org_id, from_node_id, to_node_id, type, rejected_by)
         VALUES (NULLIF(current_setting('atlas.current_org', true), '')::uuid, $1, $2, $3, $4)
         ON CONFLICT (org_id, from_node_id, to_node_id, type) DO NOTHING`,
        [e.from_node_id, e.to_node_id, e.type, userId],
      );
      await c.query(`UPDATE edges SET status = 'retired', retired_at = now() WHERE id = $1`, [id]);
      return { ok: true };
    });
  }

  /**
   * Erase a person (GDPR Art. 17). Redacts the person's identity node + scrubs their name from every
   * author/assignee/reporter attribute in the org's graph, and records the erasure (by stable URN +
   * the display names) so {@link reapplyErasures} re-applies it after each sync — a re-crawl can't
   * bring the name back. `nodeId` must be a person identity node (`*.user`). 404 if unknown/cross-org.
   */
  async erasePerson(
    orgId: string,
    nodeId: string,
    userId: string | null,
  ): Promise<{ ok: true; redactedNodes: number }> {
    if (!UUID_RE.test(nodeId)) throw ApiException.notFound();
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        urn: string;
        kind: string;
        name: string | null;
        attributes: Record<string, unknown>;
      }>(`SELECT urn, kind, name, attributes FROM nodes WHERE id = $1 AND status <> 'deleted'`, [
        nodeId,
      ]);
      const node = rows[0];
      if (!node) throw ApiException.notFound();
      if (!/\.user$/.test(node.kind)) {
        throw ApiException.invalidState(
          "Erasure applies to a person — pick a user/contributor identity, not a resource.",
        );
      }
      const names = collectIdentityNames(node.name, node.attributes);
      await c.query(
        `INSERT INTO erased_identities (org_id, urn, display_names, erased_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, urn) DO UPDATE SET display_names = EXCLUDED.display_names, erased_by = EXCLUDED.erased_by`,
        [orgId, node.urn, names, userId],
      );
      const redactedNodes = await this.applyErasure(c, [node.urn], names);
      return { ok: true, redactedNodes };
    });
  }

  /** Re-apply every recorded erasure for the org — run after each sync (onSyncComplete) so a
   *  re-ingested name is scrubbed again. Idempotent. */
  async reapplyErasures(orgId: string): Promise<number> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ urn: string; display_names: string[] }>(
        `SELECT urn, display_names FROM erased_identities`,
      );
      if (rows.length === 0) return 0;
      const urns = rows.map((r) => r.urn);
      const names = [...new Set(rows.flatMap((r) => r.display_names))];
      return this.applyErasure(c, urns, names);
    });
  }

  /** Redact identity nodes (by URN) + scrub matching author/assignee/reporter display names. Returns
   *  the number of identity nodes redacted. Runs inside the caller's org-scoped tx (RLS). */
  private async applyErasure(c: PoolClient, urns: string[], names: string[]): Promise<number> {
    let redacted = 0;
    if (urns.length > 0) {
      const r = await c.query(
        `UPDATE nodes SET name = '[erased]',
           attributes = attributes - 'login' - 'username' - 'displayName' - 'display_name'
                         - 'email' - 'nickname' - 'name'
         WHERE urn = ANY($1::text[])`,
        [urns],
      );
      redacted += r.rowCount ?? 0;
    }
    if (names.length > 0) {
      // Fixed key allowlist — safe to inline (never user input).
      for (const key of ERASE_ATTR_KEYS) {
        await c.query(
          `UPDATE nodes SET attributes = jsonb_set(attributes, '{${key}}', '"[erased]"')
             WHERE attributes->>'${key}' = ANY($1::text[])`,
          [names],
        );
      }
    }
    return redacted;
  }

  /**
   * "What changed since" (docs/08 §10.3, US-5): new/updated nodes + new edges since a
   * timestamp, merged and ordered newest-first. `kinds` filters node changes.
   */
  /**
   * Human "recent activity" for the dashboard (docs/09 §5.2). Node-centric: a PR / repo /
   * pipeline / resource *appearing* is the activity. A PR is enriched with its containing repo
   * (CONTAINS) and author (OWNED_BY) so it reads "opened in <repo> by <author>", instead of the
   * three cryptic graph events (PR node + two edges) a raw change-feed would emit. Users, teams
   * and projects are excluded (structure, not activity), as are derived nodes (connection_id NULL).
   */
  private async recentActivity(orgId: string, since: Date, limit: number): Promise<ActivityItem[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        id: string;
        kind: string;
        name: string | null;
        author_name: string | null;
        repo_name: string | null;
        act_at: Date;
      }>(
        // `act_at` is the real-world activity time - a PR's raised/merged time (updatedOn ▸
        // createdOn), a resource's own last-updated time, else when Atlas first saw it. Ordering
        // (and the displayed "N ago") by this, not first_seen, is what makes the feed chronological:
        // first_seen is the *ingest* time, identical across a bulk sync, so it can't order activity.
        `SELECT id, kind, name, author_name, repo_name, act_at FROM (
           SELECT DISTINCT ON (n.id)
                  n.id, n.kind, n.name,
                  COALESCE(
                    NULLIF(n.attributes->>'updatedOn', '')::timestamptz,
                    NULLIF(n.attributes->>'createdOn', '')::timestamptz,
                    n.first_seen
                  ) AS act_at,
                  u.name AS author_name, r.name AS repo_name
             FROM nodes n
             LEFT JOIN edges eo ON eo.from_node_id = n.id AND eo.type = 'OWNED_BY'
                                AND eo.status = 'active'
             LEFT JOIN nodes u  ON u.id = eo.to_node_id
                                AND (u.kind LIKE '%.user' OR u.kind LIKE '%.team')
             LEFT JOIN edges ec ON ec.to_node_id = n.id AND ec.type = 'CONTAINS'
                                AND ec.status = 'active'
             LEFT JOIN nodes r  ON r.id = ec.from_node_id AND r.kind LIKE '%.repository'
            WHERE n.status <> 'deleted'
              AND n.connection_id IS NOT NULL
              -- structural/inventory kinds aren't "activity" (a repo's updatedOn is just its last
              -- push, and would clutter the feed as a bogus "new repository"); PRs + real infra
              -- resource changes are. Users/teams/projects are structure too.
              AND n.kind NOT LIKE '%.user'
              AND n.kind NOT LIKE '%.team'
              AND n.kind NOT LIKE '%.project'
              AND n.kind NOT LIKE '%.repository'
              AND n.kind NOT LIKE '%.pipeline'
            ORDER BY n.id
         ) t
         WHERE act_at >= $1
         ORDER BY act_at DESC
         LIMIT $2`,
        [since.toISOString(), limit],
      );
      return rows.map((n): ActivityItem => {
        const isPr = n.kind.endsWith(".pullrequest");
        const isRepo = n.kind.endsWith(".repository");
        const isPipeline = n.kind.endsWith(".pipeline");
        const category: ActivityItem["category"] = isPr
          ? "pull_request"
          : isRepo
            ? "repository"
            : isPipeline
              ? "pipeline"
              : "resource";
        const subtitle = isPr
          ? [n.repo_name, n.author_name].filter(Boolean).join(" · ") || null
          : isPipeline
            ? n.repo_name
            : null;
        return {
          id: n.id,
          kind: n.kind,
          category,
          title: n.name ?? n.kind,
          subtitle,
          at: n.act_at.toISOString(),
        };
      });
    });
  }

  async timeline(orgId: string, q: TimelineQuery): Promise<{ data: TimelineItem[] }> {
    const since = q.since.toISOString();
    const kinds = q.kinds
      ? q.kinds
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean)
      : null;
    return withOrgScope(this.db, orgId, async (c) => {
      const nodeParams: unknown[] = [since];
      let kindFilter = "";
      if (kinds && kinds.length > 0) {
        kindFilter = ` AND kind = ANY($${nodeParams.push(kinds)}::text[])`;
      }
      const nodeRows = (
        await c.query<{
          id: string;
          urn: string;
          kind: string;
          name: string | null;
          first_seen: Date;
          last_seen: Date;
        }>(
          `SELECT id, urn, kind, name, first_seen, last_seen FROM nodes
            WHERE status <> 'deleted' AND (first_seen >= $1 OR last_seen >= $1)${kindFilter}
            ORDER BY GREATEST(first_seen, last_seen) DESC LIMIT ${q.limit}`,
          nodeParams,
        )
      ).rows;

      const edgeRows = (
        await c.query<{
          id: string;
          type: string;
          confidence: string;
          first_seen: Date;
          from_urn: string;
          from_name: string | null;
          to_urn: string;
          to_name: string | null;
        }>(
          `SELECT e.id, e.type, e.confidence, e.first_seen,
                  nf.urn AS from_urn, nf.name AS from_name, nt.urn AS to_urn, nt.name AS to_name
             FROM edges e
             JOIN nodes nf ON nf.id = e.from_node_id
             JOIN nodes nt ON nt.id = e.to_node_id
            WHERE e.status = 'active' AND e.first_seen >= $1
            ORDER BY e.first_seen DESC LIMIT ${q.limit}`,
          [since],
        )
      ).rows;

      const items: TimelineItem[] = [
        ...nodeRows.map((n): TimelineItem => {
          const created = n.first_seen >= q.since;
          return {
            changeKind: "node",
            changeType: created ? "created" : "updated",
            at: (created ? n.first_seen : n.last_seen).toISOString(),
            entity: { id: n.id, urn: n.urn, kind: n.kind, name: n.name },
          };
        }),
        ...edgeRows.map((e): TimelineItem => ({
          changeKind: "edge",
          changeType: "created",
          at: e.first_seen.toISOString(),
          entity: {
            id: e.id,
            type: e.type,
            confidence: e.confidence,
            from: { urn: e.from_urn, name: e.from_name },
            to: { urn: e.to_urn, name: e.to_name },
          },
        })),
      ];
      items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return { data: items.slice(0, q.limit) };
    });
  }

  /**
   * Bounded, cycle-guarded recursive-CTE traversal over impact-bearing edges (docs/05
   * §7.2). Carries the edge path (why-chain) and a running weakest confidence
   * (pathConfidence = weakest edge, §8). Inbound = who points at the target (blast
   * radius); outbound = what the target points at (dependencies). Depth/nodeBudget are
   * clamped with warnings, never unbounded (A21).
   */
  private async traverse(
    orgId: string,
    id: string,
    dir: "inbound" | "outbound",
    q: TraversalQuery,
  ): Promise<TraversalResult> {
    const depth = Math.min(q.depth, MAX_DEPTH);
    const budget = Math.min(q.nodeBudget, MAX_NODE_BUDGET);
    const warnings: string[] = [];
    if (q.depth > MAX_DEPTH) warnings.push(`depth clamped to ${MAX_DEPTH}`);
    if (q.nodeBudget > MAX_NODE_BUDGET) warnings.push(`nodeBudget clamped to ${MAX_NODE_BUDGET}`);
    const types = q.edgeTypes
      ? q.edgeTypes
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [...IMPACT_EDGE_TYPES];
    const minRank = confidenceRank(q.minConfidence);

    // Inbound: start at edges INTO the target, walk toward `from`. Outbound: mirror.
    const startCol = dir === "inbound" ? "to_node_id" : "from_node_id";
    const collectCol = dir === "inbound" ? "from_node_id" : "to_node_id";
    const joinCol = startCol;
    const rankExpr = `CASE e.confidence WHEN 'observed' THEN 3 WHEN 'inferred-high' THEN 2 ELSE 1 END`;

    return withOrgScope(this.db, orgId, async (c) => {
      const root = await this.loadNode(c, id);
      const { rows } = await c.query<{
        node_id: string;
        depth: number;
        edge_path: string[];
        parent_id: string;
        weakest: number;
      }>(
        // parent_id = the node one hop closer to the root on this path, so the UI can draw the
        // actual tree edges (not guessed ones). Root is the parent of the first hop.
        `WITH RECURSIVE trav AS (
           SELECT e.${collectCol} AS node_id, 1 AS depth, ARRAY[e.id] AS edge_path,
                  $1::uuid AS parent_id, ${rankExpr} AS weakest
             FROM edges e
            WHERE e.${startCol} = $1 AND e.status='active' AND e.type = ANY($2)
              AND ${rankExpr} >= $3 AND e.${collectCol} <> $1
           UNION ALL
           SELECT e.${collectCol}, t.depth + 1, t.edge_path || e.id,
                  t.node_id AS parent_id, LEAST(t.weakest, ${rankExpr})
             FROM edges e JOIN trav t ON e.${joinCol} = t.node_id
            WHERE e.status='active' AND e.type = ANY($2) AND ${rankExpr} >= $3
              AND t.depth < $4 AND e.id <> ALL(t.edge_path) AND e.${collectCol} <> $1
         )
         SELECT DISTINCT ON (node_id) node_id, depth, edge_path, parent_id, weakest
           FROM trav ORDER BY node_id, depth ASC, weakest DESC`,
        [id, types, minRank, depth],
      );

      // Order by distance, apply the node budget (truncate the tail).
      rows.sort((a, b) => a.depth - b.depth);
      const truncated = rows.length > budget;
      const kept = truncated ? rows.slice(0, budget) : rows;

      // Resolve node summaries + edge (why-chain) details in two batched lookups.
      const nodeIds = [...new Set(kept.map((r) => r.node_id))];
      const edgeIds = [...new Set(kept.flatMap((r) => r.edge_path))];
      const nodeSummaries = await this.loadNodeSummaries(c, nodeIds);
      const edgeDetails = await this.loadEdgeDetails(c, edgeIds);

      const impacted = kept
        .map((r) => {
          const node = nodeSummaries.get(r.node_id);
          if (!node) return null;
          const via = r.edge_path
            .map((eid) => edgeDetails.get(eid))
            .filter((v): v is EdgeVia => v !== undefined);
          return {
            node,
            parentId: r.parent_id,
            distance: r.depth,
            via,
            pathConfidence: rankToConfidence(r.weakest),
          };
        })
        .filter((x): x is TraversalResult["impacted"][number] => x !== null);

      return {
        root: { id: root.id, urn: root.urn, kind: root.kind, name: root.name },
        impacted,
        warnings,
        depthUsed: depth,
        nodeBudget: budget,
        truncated,
      };
    });
  }

  private async loadNodeSummaries(c: PoolClient, ids: string[]): Promise<Map<string, NodeSummary>> {
    if (ids.length === 0) return new Map();
    const { rows } = await c.query<NodeSummary>(
      `SELECT id, urn, kind, name FROM nodes WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async loadEdgeDetails(c: PoolClient, ids: string[]): Promise<Map<string, EdgeVia>> {
    if (ids.length === 0) return new Map();
    const { rows } = await c.query<{
      id: string;
      type: string;
      confidence: string;
      provenance_id: string;
      evidence: Record<string, unknown> | null;
      rule_key: string | null;
      rule_version: number | null;
    }>(
      `SELECT e.id, e.type, e.confidence, e.provenance_id, p.evidence,
              ir.key AS rule_key, ir.version AS rule_version
         FROM edges e
         LEFT JOIN provenance p ON p.id = e.provenance_id
         LEFT JOIN inference_rules ir ON ir.id = e.inference_rule_id
        WHERE e.id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(
      rows.map((r) => [
        r.id,
        {
          edgeId: r.id,
          type: r.type,
          confidence: r.confidence,
          evidence: r.evidence ?? {},
          rule: r.rule_key ? `${r.rule_key}@${r.rule_version}` : null,
          provenanceId: r.provenance_id,
        },
      ]),
    );
  }

  private async loadNode(c: PoolClient, id: string): Promise<NodeRowish> {
    if (!UUID_RE.test(id)) throw ApiException.notFound();
    const { rows } = await c.query<NodeRowish>(`SELECT ${NODE_COLS} FROM nodes WHERE id = $1`, [
      id,
    ]);
    const row = rows[0];
    if (!row) throw ApiException.notFound();
    return row;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Attributes that carry a person's display name (scrubbed on erasure). Fixed allowlist. */
const ERASE_ATTR_KEYS = ["author", "assignee", "reporter"] as const;

/** The display names a person is known by (their node name + identity attributes) — used to scrub
 *  their name from author/assignee/reporter fields on other nodes during erasure. Deduped, non-empty. */
function collectIdentityNames(name: string | null, attributes: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const add = (v: unknown): void => {
    if (typeof v === "string" && v.trim()) out.add(v);
  };
  add(name);
  for (const k of [
    "login",
    "username",
    "displayName",
    "display_name",
    "email",
    "nickname",
    "name",
  ]) {
    add(attributes?.[k]);
  }
  return [...out];
}

/** Keep only top-level scalar attributes — see the call site in {@link GraphService.graph}. Objects
 *  and arrays are dropped: the map never renders them, and they're the bulk of a raw resource's JSONB. */
function mapScalarAttributes(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

interface EdgeRow {
  id: string;
  type: string;
  origin: string;
  confidence: string;
  status: string;
  from_id: string;
  from_urn: string;
  from_kind: string;
  from_name: string | null;
  to_id: string;
  to_urn: string;
  to_kind: string;
  to_name: string | null;
}
function toEdgeDto(r: EdgeRow): EdgeDto {
  return {
    id: r.id,
    type: r.type,
    origin: r.origin,
    confidence: r.confidence,
    status: r.status,
    from: { id: r.from_id, urn: r.from_urn, kind: r.from_kind, name: r.from_name },
    to: { id: r.to_id, urn: r.to_urn, kind: r.to_kind, name: r.to_name },
  };
}
