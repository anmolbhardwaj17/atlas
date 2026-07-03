// Auto-refresh support (docs/06 §11, the dev-usable slice of the deferred Scheduler). The in-
// process scheduler runs with no session/org context, so it can't set `atlas.current_org` before
// it knows which connections are due. This SECURITY DEFINER function returns the (org, connection)
// pairs due for a re-sync across all orgs, bypassing RLS for the lookup only (mirrors 0015). The
// scheduler then scopes each sync to its org via ConnectionService.triggerSync. EXECUTE → atlas_app.
//
// Due = a usable, real (non-demo) connection with stored credentials, not currently syncing, whose
// last successful sync is older than the threshold (or never synced).

export const up: string[] = [
  `CREATE OR REPLACE FUNCTION app_due_syncs(p_threshold interval)
     RETURNS TABLE(org_id uuid, connection_id uuid)
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT c.org_id, c.id
       FROM connections c
      WHERE c.deleted_at IS NULL
        AND c.status IN ('connected', 'degraded')
        AND c.secret_ref IS NOT NULL
        AND COALESCE((c.config->>'demo')::boolean, false) = false
        AND (c.last_synced_at IS NULL OR c.last_synced_at < now() - p_threshold)
        AND NOT EXISTS (
          SELECT 1 FROM sync_runs s
           WHERE s.connection_id = c.id AND s.status IN ('queued', 'running')
        )
   $$`,
  `REVOKE ALL ON FUNCTION app_due_syncs(interval) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_due_syncs(interval) TO atlas_app`,
];

export const down: string[] = [`DROP FUNCTION IF EXISTS app_due_syncs(interval)`];
