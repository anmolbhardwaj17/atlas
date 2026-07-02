import { Inject, Injectable } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import type { PoolClient } from "pg";
import { PG_POOL } from "../core/tokens";
import { ApiException } from "../common/errors";
import {
  confidenceRank,
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
  type NodeListQuery,
  type NodeRowish,
  type TimelineQuery,
  type TraversalQuery,
} from "./dto";
import { inferEnvironment } from "./environment";

const MAX_DEPTH = 6;
const MAX_NODE_BUDGET = 500;

const NODE_COLS = `id, urn, kind, name, provider, region, status, confidence, attributes, tags,
  first_seen, last_seen`;

export interface NodeListResult {
  data: NodeDto[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

export interface OverviewResult {
  nodeCount: number;
  edgeCount: number;
  byKind: Array<{ kind: string; n: number }>;
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

/** A graph-derived thing worth a consumer's attention — cited, precision-first (P3/P4). */
export interface Finding {
  id: string;
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  detail: string;
  /** Click-through to the evidence (a node, edge, filtered list, or settings). */
  href: string | null;
  count?: number;
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
  activity: TimelineItem[];
  /** Positive, informational code stats (leaderboards) — present when a code host is connected. */
  insights: {
    topContributors: Array<{ name: string; count: number }>;
    mostActiveRepos: Array<{ name: string; count: number }>;
    pipelineCoverage: { withPipeline: number; total: number };
  };
}

/** A directed connection between two map nodes (light — just what the canvas draws). */
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
 * cross-tenant ⇒ empty/404, never leakage — R8). Node list uses keyset pagination over
 * (last_seen desc, id desc), stable under concurrent crawl writes (DD-3).
 */
@Injectable()
export class GraphService {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  /** Org overview for the dashboard (docs/09 §5.2): counts + tiers + freshness. */
  async overview(orgId: string): Promise<OverviewResult> {
    return withOrgScope(this.db, orgId, async (c) => {
      const [nodes, kinds, edges, conns, lastSync] = await Promise.all([
        c.query<{ n: number }>("SELECT count(*)::int AS n FROM nodes WHERE status <> 'deleted'"),
        c.query<{ kind: string; n: number }>(
          `SELECT kind, count(*)::int AS n FROM nodes WHERE status <> 'deleted'
           GROUP BY kind ORDER BY n DESC, kind`,
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
   * Consumer dashboard summary (docs/09 §5.2). Answers a regular user's real questions —
   * *what do I have, is it trustworthy, what needs attention, what changed* — from the graph
   * itself, not from graph internals. Findings are precision-first + cited (P3/P4): each is a
   * fact the graph proves, with a click-through to its evidence.
   */
  async summary(orgId: string): Promise<DashboardSummary> {
    const impact = [...IMPACT_EDGE_TYPES];
    // PR insight window: PRs *raised* in the last 30 days (created_on). Captures recent
    // contribution + repo activity (open or merged); a PR opened long ago doesn't count as
    // recent activity. ISO strings sort chronologically → a lexicographic >= is a correct filter.
    const prSince = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const base = await withOrgScope(this.db, orgId, async (c) => {
      const [
        cats,
        meta,
        edgeCount,
        conns,
        cross,
        blast,
        stale,
        codeCounts,
        noPipeline,
        emptyProjects,
        contributors,
        mostActiveRepos,
      ] = await Promise.all([
        c.query<{ category: string; n: number }>(
          `SELECT nk.category, count(*)::int AS n
             FROM nodes nd JOIN node_kinds nk ON nk.kind = nd.kind
            WHERE nd.status <> 'deleted' GROUP BY nk.category`,
        ),
        // Minimal columns for env inference + distinct clouds/accounts (bounded).
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
        // Highest in-degree over impact edges — the biggest single point of failure.
        c.query<{ id: string; name: string | null; kind: string; deg: number }>(
          `SELECT e.to_node_id AS id, nd.name, nd.kind, count(*)::int AS deg
             FROM edges e JOIN nodes nd ON nd.id = e.to_node_id
            WHERE e.status = 'active' AND e.type = ANY($1)
            GROUP BY e.to_node_id, nd.name, nd.kind
            ORDER BY deg DESC LIMIT 1`,
          [impact],
        ),
        c.query<{ n: number }>("SELECT count(*)::int AS n FROM nodes WHERE status = 'stale'"),
        // Code inventory (repos / projects / pipelines / people / PRs) — makes the dashboard
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
        // Repos with no CI/CD pipeline (no CONTAINS→pipeline) — a hygiene finding.
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
      ]);

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
        // provider column) — consistent with the map's `providerOf`.
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
        resources: meta.rows.length,
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
        topContributors: contributors.rows.map((r) => ({ name: r.name ?? "unknown", count: r.n })),
        mostActiveRepos: mostActiveRepos.rows.map((r) => ({
          name: r.name ?? "unknown",
          count: r.n,
        })),
      };
    });

    // ── Findings (severity-ranked, cited) ──────────────────────────────────────
    const findings: Finding[] = [];
    const STALE_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    for (const conn of base.conns) {
      if (conn.status === "error") {
        findings.push({
          id: `source-error-${conn.id}`,
          severity: "high",
          category: "Source health",
          title: `${conn.display_name} failed to sync`,
          detail: "This source errored — its slice of your graph may be out of date.",
          href: "/settings",
        });
      } else if (conn.status === "degraded") {
        findings.push({
          id: `source-degraded-${conn.id}`,
          severity: "medium",
          category: "Source health",
          title: `${conn.display_name} is degraded`,
          detail: "The last sync was partial — some resources may be missing.",
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
          detail: "Its data is older than 7 days — the graph here may have drifted.",
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
          "A resource depends on a datastore in another cloud or account — a wider blast radius (and likely egress cost).",
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
        detail: `${base.blast.deg} resources depend on it directly — if it fails, they're affected.`,
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
        detail: "Not seen in the latest sync — they may have been removed.",
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
        detail: "No deployment pipeline was found — these repos may ship manually or not at all.",
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
        detail: "An empty project — likely archived, or a placeholder that can be cleaned up.",
        href: "/explore?kind=bitbucket.project",
        count: base.emptyProjects,
      });
    }
    const rank = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

    // ── Recent activity (change feed, all-members readable) ────────────────────
    const since = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const activity = (await this.timeline(orgId, { since, limit: 6 })).data;

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
      },
      findings,
      activity,
    };
  }

  /**
   * Whole-graph fetch for the visual map (docs/09 §5.4): bounded nodes + the edges among
   * them, each node carrying its (derived) environment + account for grouping. SQL filters
   * kind/region/account; environment is inferred in-process (not a column) so it's filtered
   * after. Node-budgeted — `truncated` tells the UI to show a "showing N of many" banner.
   */
  async graph(orgId: string, q: GraphQuery): Promise<GraphResult> {
    return withOrgScope(this.db, orgId, async (c) => {
      const where = ["status <> 'deleted'"];
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
      }));
      if (q.environment) mapped = mapped.filter((n) => n.environment === q.environment);

      const truncated = mapped.length > q.limit;
      const nodes = mapped.slice(0, q.limit);
      const ids = nodes.map((n) => n.id);

      // Edges fully inside the visible node set (so the canvas never dangles an endpoint).
      const edges =
        ids.length === 0
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
                   AND from_node_id = ANY($1::uuid[]) AND to_node_id = ANY($1::uuid[])`,
                [ids],
              )
            ).rows.map((e) => ({
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

      where.push(q.status ? `status = ${p(q.status)}` : `status <> 'deleted'`);
      if (q.kind) where.push(`kind = ${p(q.kind)}`);
      if (q.region) where.push(`region = ${p(q.region)}`);
      if (q.confidence) where.push(`confidence = ${p(q.confidence)}`);
      if (q.q) where.push(`name ILIKE ${p(`%${q.q}%`)}`);
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
        },
      };
    });
  }

  async getNode(orgId: string, id: string): Promise<NodeDto & { provenance: unknown }> {
    return withOrgScope(this.db, orgId, async (c) => {
      const node = await this.loadNode(c, id);
      // Latest raw snapshot + its provenance (click-through to raw, P4).
      const prov = await c.query<{
        source: string | null;
        sync_run_id: string | null;
        observed_at: Date | null;
        confidence: string | null;
        raw_snapshot_id: string | null;
        storage_ref: string | null;
      }>(
        `SELECT p.source, p.sync_run_id, p.observed_at, p.confidence,
                rs.id AS raw_snapshot_id, rs.storage_ref
           FROM raw_snapshots rs
           LEFT JOIN provenance p ON p.raw_snapshot_id = rs.id
          WHERE rs.node_id = $1
          ORDER BY rs.captured_at DESC LIMIT 1`,
        [id],
      );
      const pr = prov.rows[0];
      return {
        ...toNodeDto(node),
        provenance: pr
          ? {
              source: pr.source,
              syncRunId: pr.sync_run_id,
              observedAt: pr.observed_at?.toISOString() ?? null,
              confidence: pr.confidence,
              rawSnapshotId: pr.raw_snapshot_id,
              rawSnapshotRef: pr.storage_ref,
            }
          : null,
      };
    });
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

  /** Inbound impact closure — "what breaks if this is deleted" (US-4, docs/08 §9). */
  async blastRadius(orgId: string, id: string, q: TraversalQuery): Promise<TraversalResult> {
    return this.traverse(orgId, id, "inbound", q);
  }
  /** Outbound dependency closure — "what this depends on" (US-9). */
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

  /**
   * "What changed since" (docs/08 §10.3, US-5): new/updated nodes + new edges since a
   * timestamp, merged and ordered newest-first. `kinds` filters node changes.
   */
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
        weakest: number;
      }>(
        `WITH RECURSIVE trav AS (
           SELECT e.${collectCol} AS node_id, 1 AS depth, ARRAY[e.id] AS edge_path,
                  ${rankExpr} AS weakest
             FROM edges e
            WHERE e.${startCol} = $1 AND e.status='active' AND e.type = ANY($2)
              AND ${rankExpr} >= $3 AND e.${collectCol} <> $1
           UNION ALL
           SELECT e.${collectCol}, t.depth + 1, t.edge_path || e.id,
                  LEAST(t.weakest, ${rankExpr})
             FROM edges e JOIN trav t ON e.${joinCol} = t.node_id
            WHERE e.status='active' AND e.type = ANY($2) AND ${rankExpr} >= $3
              AND t.depth < $4 AND e.id <> ALL(t.edge_path) AND e.${collectCol} <> $1
         )
         SELECT DISTINCT ON (node_id) node_id, depth, edge_path, weakest
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
          return { node, distance: r.depth, via, pathConfidence: rankToConfidence(r.weakest) };
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
