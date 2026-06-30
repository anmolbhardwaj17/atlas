// Tenant isolation (docs/04 §10, docs/13 §6). The APP connects as the dedicated,
// non-bypass `atlas_app` role and sets the `atlas.current_org` GUC per request/job;
// RLS then filters every row. MIGRATIONS connect as the owner (e.g. Supabase
// `postgres`) — owners/bypass roles skip RLS, which is why the app must NOT use them.
//
// Fail-closed (docs/13 SEC-9): NULLIF(current_setting(...), '') maps both an unset
// GUC (NULL) and a reset-to-empty GUC ('') to NULL → matches no rows (the empty case
// happens on pooled connections; a bare ''::uuid would throw — verified).
//
// Idempotent (safe to re-run). NOTE: atlas_app is created NOLOGIN here; each
// environment grants it LOGIN + a password out-of-band (never a secret in code) and
// the app connects as it. This is our org-scoped model — NOT Supabase auth.uid().

export const up: string[] = [
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
       CREATE ROLE atlas_app NOLOGIN NOBYPASSRLS;
     END IF;
   END
   $$`,
  `GRANT USAGE ON SCHEMA public TO atlas_app`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atlas_app`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_app`,

  `ALTER TABLE memberships ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS tenant_isolation_memberships ON memberships`,
  `CREATE POLICY tenant_isolation_memberships ON memberships
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,

  `ALTER TABLE invitations ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS tenant_isolation_invitations ON invitations`,
  `CREATE POLICY tenant_isolation_invitations ON invitations
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
];

export const down: string[] = [
  `DROP POLICY IF EXISTS tenant_isolation_invitations ON invitations`,
  `ALTER TABLE invitations DISABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS tenant_isolation_memberships ON memberships`,
  `ALTER TABLE memberships DISABLE ROW LEVEL SECURITY`,
  `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM atlas_app`,
  `REVOKE USAGE ON SCHEMA public FROM atlas_app`,
];
