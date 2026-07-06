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
  /** State CHANGES recorded to node_events (healthy→unhealthy etc.) - Phase C timeline. */
  transitions: number;
}

export async function applyHealthObservations(
  db: Db,
  orgId: string,
  observations: HealthObservationInput[],
): Promise<HealthApplyResult> {
  if (observations.length === 0) return { applied: 0, unmatched: 0, transitions: 0 };
  return withOrgScope(db, orgId, async (c) => {
    let applied = 0;
    let transitions = 0;
    for (const o of observations) {
      // Single statement: read the previous state, write the new annotation, report both -
      // a state CHANGE becomes a health_transition timeline event (Phase C).
      const res = await c.query<{ id: string; prev_state: string | null }>(
        `WITH prev AS (
           SELECT id, attributes->'health'->>'state' AS prev_state
             FROM nodes WHERE urn = $1 AND deleted_at IS NULL
         )
         UPDATE nodes n
            SET attributes = n.attributes || jsonb_build_object('health', $2::jsonb)
           FROM prev
          WHERE n.id = prev.id
          RETURNING n.id, prev.prev_state`,
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
      const row = res.rows[0];
      if (!row) continue;
      applied += 1;

      const prev = row.prev_state;
      if (prev !== o.state && !(prev == null && o.state === "healthy")) {
        // First sighting as healthy is not a story; any other change is.
        await c.query(
          `INSERT INTO node_events (org_id, node_id, kind, occurred_at, actor, title, evidence, source, dedupe_key)
           VALUES (current_setting('atlas.current_org')::uuid, $1, 'health_transition', $2, NULL, $3, $4::jsonb, 'health-poll', $5)
           ON CONFLICT (org_id, dedupe_key) DO NOTHING`,
          [
            row.id,
            o.checkedAt,
            `Health ${prev ?? "unknown"} → ${o.state}: ${o.reason}`,
            JSON.stringify({ from: prev, to: o.state, ...o.evidence }),
            `health:${o.urn}:${o.checkedAt}:${o.state}`,
          ],
        );
        transitions += 1;
      }
    }
    return { applied, unmatched: observations.length - applied, transitions };
  });
}
