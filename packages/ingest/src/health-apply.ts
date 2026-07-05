/**
 * Persist runtime-health observations onto graph nodes (operational-intelligence
 * Phase B). Health lives under `attributes.health` — a point-in-time annotation, NOT a
 * node/edge (structure) and NOT freshness (`status`): a node can be fresh-but-unhealthy
 * or stale-but-healthy, and the UI shows both independently (docs/09 §7).
 *
 * Trust: only nodes named by an observation are touched; everything else keeps its
 * previous health (with its old `checkedAt` visible) or stays `unknown`. Runs inside
 * one org-scoped transaction (RLS).
 */
import { withOrgScope, type Db } from "@atlas/db";

export interface HealthObservationInput {
  urn: string;
  state: "healthy" | "degraded" | "unhealthy";
  reason: string;
  evidence: Record<string, unknown>;
  checkedAt: string;
}

export interface HealthApplyResult {
  /** Observations that matched (and annotated) a live node. */
  applied: number;
  /** Observations whose URN has no live node in the graph (target not crawled). */
  unmatched: number;
}

export async function applyHealthObservations(
  db: Db,
  orgId: string,
  observations: HealthObservationInput[],
): Promise<HealthApplyResult> {
  if (observations.length === 0) return { applied: 0, unmatched: 0 };
  return withOrgScope(db, orgId, async (c) => {
    let applied = 0;
    for (const o of observations) {
      const res = await c.query(
        `UPDATE nodes
            SET attributes = attributes || jsonb_build_object('health', $2::jsonb)
          WHERE urn = $1 AND deleted_at IS NULL`,
        [
          o.urn,
          JSON.stringify({
            state: o.state,
            reason: o.reason,
            evidence: o.evidence,
            checkedAt: o.checkedAt,
          }),
        ],
      );
      applied += res.rowCount ?? 0;
    }
    return { applied, unmatched: observations.length - applied };
  });
}
