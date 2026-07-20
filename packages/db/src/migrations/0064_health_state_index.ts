// Partial expression index for the health map + unhealthy findings (backend audit, medium bucket).
// The map's health lens and the "degraded/unhealthy resources" panels filter on
// `attributes->'health'->>'state' IN ('degraded','unhealthy')` (graph.service.ts) — a JSONB path
// dereference that can't use the plain attributes GIN. A PARTIAL index keyed by that expression, over
// ONLY the degraded/unhealthy rows, is tiny (most nodes are healthy/unknown) and org-prefixed so it
// serves the org-scoped health queries directly instead of scanning every node.
//
// NOTE (at scale): plain CREATE INDEX (transactional runner) — instant on today's tables; build
// CONCURRENTLY out-of-band if `nodes` is already large at first deploy (same caveat as 0055/0063).

export const up: string[] = [
  `CREATE INDEX IF NOT EXISTS ix_nodes_health_state
     ON nodes (org_id, (attributes->'health'->>'state'))
     WHERE attributes->'health'->>'state' IN ('degraded','unhealthy')`,
];

export const down: string[] = [`DROP INDEX IF EXISTS ix_nodes_health_state`];
