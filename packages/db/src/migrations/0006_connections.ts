// Connections & sync_runs — the ingest substrate (docs/04 §5.2, docs/03 §3.5/§3.6,
// F2). `connections` is the hinge between the platform and knowledge models (a
// source link); `sync_runs` is the unit of freshness/history. Both are org-scoped,
// so — like memberships/invitations — they get an org-scope RLS policy TO atlas_app
// (Supabase auto-enables RLS on all public tables; a table with RLS and no policy is
// denied to the non-bypass app role).
//
// secret_ref is a POINTER into the Secrets Broker, never the secret itself (BR-CONN-1,
// docs/13 §7). BR-SYNC-1 (at most one in-flight run per connection) is a partial
// unique index. Idempotent (guarded policy drops). Fail-closed via the shared
// NULLIF(...,'') GUC pattern (0002).

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE connections (
     id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     provider       text NOT NULL CHECK (provider IN ('aws','github')),
     display_name   text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
     status         text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','verifying','connected','degraded','error','disconnected')),
     config         jsonb NOT NULL DEFAULT '{}'::jsonb,
     secret_ref     text,
     health         jsonb NOT NULL DEFAULT '{}'::jsonb,
     last_error     text,
     last_synced_at timestamptz,
     created_at     timestamptz NOT NULL DEFAULT now(),
     updated_at     timestamptz NOT NULL DEFAULT now(),
     deleted_at     timestamptz
   )`,
  `CREATE TRIGGER trg_conn_updated BEFORE UPDATE ON connections
     FOR EACH ROW EXECUTE FUNCTION set_updated_at()`,
  `CREATE INDEX ix_connections_org ON connections(org_id)`,

  `CREATE TABLE sync_runs (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
     type          text NOT NULL CHECK (type IN ('full','incremental','webhook')),
     status        text NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),
     trigger       text NOT NULL CHECK (trigger IN ('scheduled','manual','onboarding','webhook')),
     checkpoint    jsonb NOT NULL DEFAULT '{}'::jsonb,
     stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
     scope_result  jsonb NOT NULL DEFAULT '{}'::jsonb,
     started_at    timestamptz,
     finished_at   timestamptz,
     created_at    timestamptz NOT NULL DEFAULT now()
   )`,
  // BR-SYNC-1: at most one in-flight run per connection.
  `CREATE UNIQUE INDEX uq_sync_inflight ON sync_runs(connection_id)
     WHERE status IN ('queued','running')`,
  `CREATE INDEX ix_sync_runs_conn ON sync_runs(connection_id, created_at DESC)`,

  // Org-scoped RLS (TO atlas_app; anon/authenticated intentionally have no policy).
  `ALTER TABLE connections ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_connections ON connections`,
  `CREATE POLICY org_scope_connections ON connections FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,

  `ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_sync_runs ON sync_runs`,
  `CREATE POLICY org_scope_sync_runs ON sync_runs FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
];

export const down: string[] = [
  `DROP TABLE IF EXISTS sync_runs CASCADE`,
  `DROP TABLE IF EXISTS connections CASCADE`,
];
