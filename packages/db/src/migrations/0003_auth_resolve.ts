// Identity → tenancy resolution (docs/12 §3–§4, F1.5). The Supabase JWT carries
// no orgId/role (Supabase doesn't know our tenancy), so the API must look up which
// orgs the authenticated user belongs to. That is a *cross-org* read, which our
// org-scoped RLS (migration 0002) deliberately forbids the non-bypass `atlas_app`
// role from doing.
//
// `app_user_memberships(uuid)` is the single sanctioned exception: a SECURITY
// DEFINER function (runs as its owner — the migration role, which bypasses RLS)
// that returns ONLY the passed user's active memberships. It is keyed strictly to
// one user, EXECUTE is revoked from PUBLIC and granted only to atlas_app, and
// `search_path` is pinned (SECURITY DEFINER hardening). This keeps atlas_app
// itself non-bypass while giving the auth guard exactly the read it needs (docs/12
// §4 step 2). This is our model — NOT Supabase auth.uid()-in-RLS.
//
// Idempotent (CREATE OR REPLACE + guarded GRANT/REVOKE). Safe to re-run.

export const up: string[] = [
  `CREATE OR REPLACE FUNCTION app_user_memberships(p_user_id uuid)
     RETURNS TABLE (org_id uuid, org_slug citext, org_name text, role text)
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT m.org_id, o.slug, o.name, m.role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = p_user_id
       AND m.status = 'active'
       AND o.status <> 'deleting'
     ORDER BY o.created_at, o.slug
   $$`,
  `REVOKE ALL ON FUNCTION app_user_memberships(uuid) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_user_memberships(uuid) TO atlas_app`,
];

export const down: string[] = [`DROP FUNCTION IF EXISTS app_user_memberships(uuid)`];
