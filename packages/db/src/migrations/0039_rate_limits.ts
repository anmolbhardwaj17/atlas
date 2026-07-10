// Fixed-window rate-limit / budget counters (security sweep H2 + M4). One row per
// (org, bucket, window_start); the app increments `count` and refuses once it exceeds the bucket's
// limit. Durable + multi-instance-safe (unlike an in-memory limiter) and org-scoped so the counters
// live under the same RLS as every other tenant table (R8) — the app writes them inside withOrgScope.
// Buckets today: `ai_ask` (per-org burst), `ai_shared` (per-org daily budget on Atlas's shared LLM
// key — the cost-DoS bound), `invite` (per-org invite-email rate). Rows are disposable; a periodic
// prune can delete windows older than a day, but stale rows are simply never read again.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS rate_limits (
     org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     bucket       text NOT NULL,
     window_start timestamptz NOT NULL,
     count        integer NOT NULL DEFAULT 0,
     PRIMARY KEY (org_id, bucket, window_start)
   )`,
  `ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_rate_limits ON rate_limits`,
  `CREATE POLICY org_scope_rate_limits ON rate_limits FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS rate_limits`];
