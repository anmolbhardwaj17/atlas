// Background reaper for orphaned sync runs (reliability hardening). The opportunistic reaper in
// attachSyncInfo only fires when someone loads the connections page — so an orphaned queued/running
// run (worker lost/restarted) could sit forever and permanently block new syncs via the
// uq_sync_inflight unique index. This SECURITY DEFINER function reaps stale in-flight runs across
// ALL orgs (cross-org, so it can't be a per-request RLS-scoped query) and returns how many it
// reaped; a bootstrap timer calls it on a cadence. Detection is staleness-based (updated_at), same
// as the opportunistic reaper, so a legitimately-slow-but-alive run isn't reaped mid-flight.

export const up: string[] = [
  `CREATE OR REPLACE FUNCTION app_reap_orphaned_syncs(p_threshold interval)
     RETURNS integer
     LANGUAGE sql
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     WITH reaped AS (
       UPDATE sync_runs
          SET status = 'failed', finished_at = now(),
              scope_result = COALESCE(scope_result, '{}'::jsonb)
                || '{"reaped": "in-flight run orphaned (worker lost or restarted)"}'::jsonb
        WHERE (status = 'queued'  AND created_at < now() - p_threshold)
           OR (status = 'running' AND updated_at < now() - p_threshold)
        RETURNING 1
     )
     SELECT count(*)::int FROM reaped
   $$`,
  `REVOKE ALL ON FUNCTION app_reap_orphaned_syncs(interval) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_reap_orphaned_syncs(interval) TO atlas_app`,
];

export const down: string[] = [`DROP FUNCTION IF EXISTS app_reap_orphaned_syncs(interval)`];
