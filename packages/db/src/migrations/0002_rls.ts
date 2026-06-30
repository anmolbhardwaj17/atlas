import { sql, type Kysely } from "kysely";

// Tenant isolation backstop (docs/04 §10, docs/13 §6). The app/workers connect
// as (or drop to) the restricted, non-owner `atlas_app` role and set the
// `atlas.current_org` GUC per request/job; RLS then filters every row.
//
// Fail-closed (docs/13 SEC-9): the policy uses NULLIF(current_setting(...), '')
// so that BOTH an unset GUC (NULL) and a reset-to-empty GUC ('') yield NULL —
// `org_id = NULL` matches nothing → no rows. The empty-string case is real:
// on a POOLED connection, a custom GUC previously set via SET LOCAL resets to
// '' (not NULL) for the next transaction, and a bare ''::uuid would otherwise
// throw. (Verified against Postgres — connection reuse surfaced this.)
//
// This is our org-scoped model — NOT Supabase's auth.uid() pattern (CLAUDE.md).

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'atlas_app') THEN
        CREATE ROLE atlas_app NOLOGIN;
      END IF;
    END
    $$
  `.execute(db);

  await sql`GRANT USAGE ON SCHEMA public TO atlas_app`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atlas_app`.execute(
    db,
  );
  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO atlas_app
  `.execute(db);

  // RLS on the org-scoped tables present in F1. Graph tables get the same
  // treatment in the G sprints; the full cross-surface US-12 test expands then.
  await sql`ALTER TABLE memberships ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation_memberships ON memberships
      USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
  `.execute(db);

  await sql`ALTER TABLE invitations ENABLE ROW LEVEL SECURITY`.execute(db);
  await sql`
    CREATE POLICY tenant_isolation_invitations ON invitations
      USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP POLICY IF EXISTS tenant_isolation_invitations ON invitations`.execute(db);
  await sql`ALTER TABLE invitations DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`DROP POLICY IF EXISTS tenant_isolation_memberships ON memberships`.execute(db);
  await sql`ALTER TABLE memberships DISABLE ROW LEVEL SECURITY`.execute(db);
  await sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM atlas_app`.execute(db);
  await sql`REVOKE USAGE ON SCHEMA public FROM atlas_app`.execute(db);
  // Role left in place (may be shared); drop manually if needed.
}
