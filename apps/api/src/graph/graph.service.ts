import { Inject, Injectable } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import type { PoolClient } from "pg";
import { PG_POOL } from "../core/tokens";
import { ApiException } from "../common/errors";
import {
  decodeCursor,
  encodeCursor,
  toNodeDto,
  type EdgesQuery,
  type NeighborsQuery,
  type NodeDto,
  type NodeListQuery,
  type NodeRowish,
} from "./dto";

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
