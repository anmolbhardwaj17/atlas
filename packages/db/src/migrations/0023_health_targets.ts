// Runtime-health polling support (docs/plans/operational-intelligence.md Phase B). Like
// app_due_syncs (0021), the in-process health poller runs with no org context, so this
// SECURITY DEFINER function lists the (org, connection) pairs eligible for a health pass
// across all orgs — RLS bypassed for the lookup only; the poller then org-scopes every
// read/write. Eligible = a usable, real (non-demo) AWS connection with stored credentials.
// (AWS-only today: it's the only provider with runtime health to read. Extend the WHERE
// when another provider gains a health collector.) EXECUTE → atlas_app.

export const up: string[] = [
  `CREATE OR REPLACE FUNCTION app_health_targets()
     RETURNS TABLE(org_id uuid, connection_id uuid)
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT c.org_id, c.id
       FROM connections c
      WHERE c.deleted_at IS NULL
        AND c.provider = 'aws'
        AND c.status IN ('connected', 'degraded')
        AND c.secret_ref IS NOT NULL
        AND COALESCE((c.config->>'demo')::boolean, false) = false
   $$`,
  `REVOKE ALL ON FUNCTION app_health_targets() FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_health_targets() TO atlas_app`,
];

export const down: string[] = [`DROP FUNCTION IF EXISTS app_health_targets()`];
