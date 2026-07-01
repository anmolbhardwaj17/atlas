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
  type NeighborsQuery,
  type NodeDto,
  type NodeListQuery,
  type NodeRowish,
  type TimelineQuery,
  type TraversalQuery,
} from "./dto";

const MAX_DEPTH = 6;
const MAX_NODE_BUDGET = 500;

const NODE_COLS = `id, urn, kind, name, provider, region, status, confidence, attributes, tags,
  first_seen, last_seen`;

export interface NodeListResult {
  data: NodeDto[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
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
