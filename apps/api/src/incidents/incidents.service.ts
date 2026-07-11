import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { withOrgScope, type Db } from "@atlas/db";
import { PG_POOL } from "../core/tokens";
import { ApiException } from "../common/errors";

export type IncidentTrigger = "map" | "finding" | "alert" | "manual";
export type IncidentStatus = "open" | "analyzing" | "resolved" | "dismissed";
export type IncidentSeverity = "high" | "medium" | "low";

/** A persisted War Room investigation (docs/plans/war-room.md). */
export interface Incident {
  id: string;
  nodeId: string;
  nodeName: string | null;
  nodeKind: string | null;
  title: string;
  trigger: IncidentTrigger;
  status: IncidentStatus;
  severity: IncidentSeverity | null;
  /** Ranked, classified hypotheses from the diagnose loop (null until diagnosed). */
  verdict: unknown | null;
  /** Assembled evidence bundle + streamed step trace (P4). */
  evidence: unknown;
  resolution: string | null;
  openedBy: string | null;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface IncidentRow {
  id: string;
  node_id: string;
  node_name: string | null;
  node_kind: string | null;
  title: string;
  trigger: IncidentTrigger;
  status: IncidentStatus;
  severity: IncidentSeverity | null;
  verdict: unknown | null;
  evidence: unknown;
  resolution: string | null;
  opened_by: string | null;
  opened_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const SELECT = `SELECT i.id, i.node_id, n.name AS node_name, n.kind AS node_kind, i.title, i.trigger,
                       i.status, i.severity, i.verdict, i.evidence, i.resolution, i.opened_by,
                       i.opened_at, i.updated_at, i.resolved_at
                  FROM incidents i
                  LEFT JOIN nodes n ON n.id = i.node_id AND n.org_id = i.org_id`;

/**
 * War Room incidents (docs/plans/war-room.md): open/reuse an investigation for a broken node, attach the
 * diagnose loop's verdict + step trace, and list them for the Insights "Past incidents" view. Org-scoped
 * throughout (R8) — a missing/foreign node or incident is a 404 (never a 403, never cross-tenant).
 */
@Injectable()
export class IncidentsService {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  /** Open a War Room for a node — or reuse the one already open (the partial unique index guarantees
   *  at most one live investigation per node, so double-clicking "Take to War Room" is idempotent). */
  async open(
    orgId: string,
    userId: string | null,
    input: { nodeId: string; trigger: IncidentTrigger },
  ): Promise<Incident> {
    return withOrgScope(this.db, orgId, async (c) => {
      const node = (
        await c.query<{ id: string; name: string | null; kind: string; attributes: unknown }>(
          `SELECT id, name, kind, attributes FROM nodes WHERE id = $1 AND deleted_at IS NULL`,
          [input.nodeId],
        )
      ).rows[0];
      if (!node) throw ApiException.notFound("Resource not found.");

      const health = (node.attributes as { health?: { state?: string; reason?: string } } | null)
        ?.health;
      const state = health?.state;
      const title = `${node.name ?? node.kind}${state ? ` — ${state}` : ""}`;
      const severity: IncidentSeverity | null =
        state === "unhealthy" ? "high" : state === "degraded" ? "medium" : null;

      // Insert, or reuse the existing open/analyzing incident for this node.
      const ins = await c.query<{ id: string }>(
        `INSERT INTO incidents (org_id, node_id, title, trigger, severity, opened_by)
         VALUES (NULLIF(current_setting('atlas.current_org', true), '')::uuid, $1, $2, $3, $4, $5)
         ON CONFLICT (org_id, node_id) WHERE status IN ('open','analyzing') DO NOTHING
         RETURNING id`,
        [input.nodeId, title, input.trigger, severity, userId],
      );
      const id =
        ins.rows[0]?.id ??
        (
          await c.query<{ id: string }>(
            `SELECT id FROM incidents WHERE node_id = $1 AND status IN ('open','analyzing')
             ORDER BY opened_at DESC LIMIT 1`,
            [input.nodeId],
          )
        ).rows[0]?.id;
      if (!id) throw ApiException.notFound("Resource not found.");
      return this.getRow(c, id);
    });
  }

  async get(orgId: string, id: string): Promise<Incident> {
    return withOrgScope(this.db, orgId, (c) => this.getRow(c, id));
  }

  async list(
    orgId: string,
    opts: { status?: IncidentStatus; limit?: number } = {},
  ): Promise<Incident[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return withOrgScope(this.db, orgId, async (c) => {
      const params: unknown[] = [];
      const where = opts.status ? `WHERE i.status = $${params.push(opts.status)}` : "";
      const rows = (
        await c.query<IncidentRow>(
          `${SELECT} ${where} ORDER BY i.opened_at DESC LIMIT $${params.push(limit)}`,
          params,
        )
      ).rows;
      return rows.map(toIncident);
    });
  }

  /** Attach diagnosis results (verdict + evidence/step trace) or change lifecycle (resolve/dismiss). */
  async update(
    orgId: string,
    id: string,
    patch: {
      status?: IncidentStatus;
      verdict?: unknown;
      evidence?: unknown;
      resolution?: string | null;
    },
  ): Promise<Incident> {
    return withOrgScope(this.db, orgId, async (c) => {
      const sets: string[] = ["updated_at = now()"];
      const params: unknown[] = [];
      if (patch.status !== undefined) {
        sets.push(`status = $${params.push(patch.status)}`);
        // Stamp/clear the resolution time when entering/leaving a terminal state.
        sets.push(
          patch.status === "resolved" || patch.status === "dismissed"
            ? "resolved_at = now()"
            : "resolved_at = NULL",
        );
      }
      if (patch.verdict !== undefined)
        sets.push(`verdict = $${params.push(JSON.stringify(patch.verdict))}::jsonb`);
      if (patch.evidence !== undefined)
        sets.push(`evidence = $${params.push(JSON.stringify(patch.evidence))}::jsonb`);
      if (patch.resolution !== undefined)
        sets.push(`resolution = $${params.push(patch.resolution)}`);

      const res = await c.query<{ id: string }>(
        `UPDATE incidents SET ${sets.join(", ")} WHERE id = $${params.push(id)} RETURNING id`,
        params,
      );
      if (!res.rows[0]) throw ApiException.notFound("Resource not found.");
      return this.getRow(c, id);
    });
  }

  private async getRow(c: PoolClient, id: string): Promise<Incident> {
    const row = (await c.query<IncidentRow>(`${SELECT} WHERE i.id = $1`, [id])).rows[0];
    if (!row) throw ApiException.notFound("Resource not found.");
    return toIncident(row);
  }
}

function toIncident(r: IncidentRow): Incident {
  return {
    id: r.id,
    nodeId: r.node_id,
    nodeName: r.node_name,
    nodeKind: r.node_kind,
    title: r.title,
    trigger: r.trigger,
    status: r.status,
    severity: r.severity,
    verdict: r.verdict ?? null,
    evidence: r.evidence ?? {},
    resolution: r.resolution,
    openedBy: r.opened_by,
    openedAt: r.opened_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}
