// FK-index hygiene (docs/04 §6). PostgreSQL does NOT auto-index foreign-key columns; an unindexed FK
// makes the parent's DELETE do an O(rows) Seq Scan of the child to enforce the constraint. Verified via
// `EXPLAIN` with `enable_seqscan=off` (2026-07-13): these five columns Seq-Scan on lookup, while every
// HOT read path is already covered by the org-prefixed composites. None of these are needed for current
// reads — they exist to keep the upcoming retention purges (Phase 2b: deleting old sync_runs /
// raw_snapshots / provenance) and cascade deletes from degrading, plus "what did this sync touch"
// reverse lookups.
//
// These deliberately LEAD with the FK column, not org_id (an exception to SP-9): a cascade check starts
// from a specific parent row (by its PK), not from a tenant, so an org-prefixed index can't serve it.
//
// NOTE (at scale): our migration runner is transactional, so these are plain CREATE INDEX (instant on
// today's KB-sized tables). If a table is large when this first runs in a real deploy, build the index
// CONCURRENTLY out-of-band instead.

export const up: string[] = [
  `CREATE INDEX IF NOT EXISTS ix_prov_snapshot   ON provenance(raw_snapshot_id)`,
  `CREATE INDEX IF NOT EXISTS ix_prov_sync        ON provenance(sync_run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_edges_prov       ON edges(provenance_id)`,
  `CREATE INDEX IF NOT EXISTS ix_nodes_last_sync  ON nodes(last_sync_run_id)`,
  `CREATE INDEX IF NOT EXISTS ix_edges_last_sync  ON edges(last_sync_run_id)`,
];

export const down: string[] = [
  `DROP INDEX IF EXISTS ix_prov_snapshot`,
  `DROP INDEX IF EXISTS ix_prov_sync`,
  `DROP INDEX IF EXISTS ix_edges_prov`,
  `DROP INDEX IF EXISTS ix_nodes_last_sync`,
  `DROP INDEX IF EXISTS ix_edges_last_sync`,
];
