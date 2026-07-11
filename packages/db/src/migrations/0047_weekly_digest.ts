// Weekly digest email (#44). A per-membership opt-out + two SECURITY DEFINER helpers: one to list
// digest recipients cross-org (the scheduler can't run per-request RLS), one to honor an unsubscribe
// from the token-signed email link. Only orgs with a connected source get a digest (no empty-org mail).

export const up: string[] = [
  `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS digest_opt_out boolean NOT NULL DEFAULT false`,

  `CREATE OR REPLACE FUNCTION app_weekly_digest_recipients()
     RETURNS TABLE(org_id uuid, org_name text, user_id uuid, email text)
     LANGUAGE sql
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT m.org_id, o.name, m.user_id, u.email::text
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
       JOIN users u ON u.id = m.user_id
      WHERE m.status = 'active'
        AND m.digest_opt_out = false
        AND u.email IS NOT NULL
        AND EXISTS (SELECT 1 FROM connections c WHERE c.org_id = m.org_id AND c.deleted_at IS NULL)
   $$`,
  `REVOKE ALL ON FUNCTION app_weekly_digest_recipients() FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_weekly_digest_recipients() TO atlas_app`,

  `CREATE OR REPLACE FUNCTION app_digest_unsubscribe(p_user uuid, p_org uuid)
     RETURNS boolean
     LANGUAGE sql
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     WITH upd AS (
       UPDATE memberships SET digest_opt_out = true, updated_at = now()
        WHERE user_id = p_user AND org_id = p_org
        RETURNING 1
     )
     SELECT EXISTS (SELECT 1 FROM upd)
   $$`,
  `REVOKE ALL ON FUNCTION app_digest_unsubscribe(uuid, uuid) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_digest_unsubscribe(uuid, uuid) TO atlas_app`,
];

export const down: string[] = [
  `DROP FUNCTION IF EXISTS app_weekly_digest_recipients()`,
  `DROP FUNCTION IF EXISTS app_digest_unsubscribe(uuid, uuid)`,
  `ALTER TABLE memberships DROP COLUMN IF EXISTS digest_opt_out`,
];
