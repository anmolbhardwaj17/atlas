// H3 (backend production audit — Phase C): the Postgres search provider's hot WHERE
// (`postgres-search.provider.ts`) — which is ALSO the AI-retrieval fallback on every "Ask Atlas"
// turn — filters on `urn ILIKE '%q%'` and `attributes::text ILIKE '%q%'`, and no index could serve
// either. So every keyword search Seq-Scanned `nodes` and re-cast every row's whole JSONB to text.
// `name` already had a gin_trgm index (ix_nodes_name_trgm, migration 0007); these add the matching
// trigram indexes for the other two predicates so the ENTIRE search WHERE is now index-backed.
//
// We INDEX `attributes::text` (a functional gin_trgm) rather than DROP attribute-keyword matching
// (the audit's stated alternative). Rationale: normalized `attributes` are small scalar maps (region,
// engine, instanceId, … — the bulky raw payload lives in raw_snapshots/Storage, not here), and
// matching e.g. an RDS instance by its `engine=postgres` is real, test-covered retrieval behavior.
// Indexing fixes the actual defect (the Seq-Scan + per-row cast) WITHOUT regressing recall on the hot
// AI path. gin_trgm serves ILIKE '%q%' for q ≥ 3 chars; shorter queries recheck rows, same as before.
//
// NOTE (at scale): plain CREATE INDEX (not CONCURRENTLY) because the migration runner is
// transactional — instant on today's tables. If `nodes` is already large at first real deploy, build
// these CONCURRENTLY out-of-band instead (same caveat as migration 0055).

export const up: string[] = [
  `CREATE INDEX IF NOT EXISTS ix_nodes_urn_trgm        ON nodes USING gin (urn gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS ix_nodes_attrs_text_trgm ON nodes USING gin ((attributes::text) gin_trgm_ops)`,
];

export const down: string[] = [
  `DROP INDEX IF EXISTS ix_nodes_urn_trgm`,
  `DROP INDEX IF EXISTS ix_nodes_attrs_text_trgm`,
];
