// Identity-table RLS policies (docs/04 §10, docs/12 §2.2).
//
// Supabase auto-enables RLS on EVERY table in the `public` schema (a built-in
// event trigger — security-by-default for its REST API). Our 0002 migration only
// added policies to the org-scoped tables (memberships, invitations), so the
// global identity tables (users, auth_identities) ended up RLS-enabled with NO
// policy → the non-bypass `atlas_app` role is denied all access (deny-by-default),
// which broke the /me user-mirror (docs/12 §2.2).
//
// These tables are NOT org-scoped (a user/identity is global — `03` BR-USER-1), so
// they are not subject to the `atlas.current_org` GUC. We grant `atlas_app` full
// access via policies scoped `TO atlas_app`. Critically we do NOT add a policy for
// `anon`/`authenticated` (the Supabase PostgREST roles): with no policy they stay
// denied, so these tables can never leak through the REST API (defense in depth —
// the app reaches them only through its trusted direct Postgres connection).
//
// Idempotent (DROP POLICY IF EXISTS first). Org-scoped `organizations` policies
// are added in F1.6 with org CRUD; for now its rows are read only through the
// SECURITY DEFINER resolver (migration 0003), which bypasses RLS.

export const up: string[] = [
  `DROP POLICY IF EXISTS app_rw_users ON users`,
  `CREATE POLICY app_rw_users ON users FOR ALL TO atlas_app USING (true) WITH CHECK (true)`,

  `DROP POLICY IF EXISTS app_rw_auth_identities ON auth_identities`,
  `CREATE POLICY app_rw_auth_identities ON auth_identities FOR ALL TO atlas_app USING (true) WITH CHECK (true)`,
];

export const down: string[] = [
  `DROP POLICY IF EXISTS app_rw_auth_identities ON auth_identities`,
  `DROP POLICY IF EXISTS app_rw_users ON users`,
];
