// Retention / storage-limitation (docs/13 §retention; compliance scan S2). The unbounded ledgers —
// raw snapshots, node_events, sync_runs, analytics_events — grew forever, breaching GDPR Art. 5(1)(e)
// and our own policy. This SECURITY DEFINER sweep deletes rows past their per-table window ACROSS all
// orgs in one call (retention is age-based + org-agnostic; runs as the owner so it bypasses RLS like
// the digest helpers). It returns the deleted snapshot storage_refs so the caller can erase the blobs
// too (the row is only a pointer). Idempotent: a second run finds nothing. Windows are parameters so
// policy lives in app config. Audit_events are deliberately NOT purged here — a compliance trail is
// kept long and only aged out by a separate, explicit policy. Nodes are left to sync reconciliation.

export const up: string[] = [
  `CREATE OR REPLACE FUNCTION app_purge_expired(
     p_snapshot_days   int DEFAULT 30,
     p_node_event_days int DEFAULT 365,
     p_sync_run_days   int DEFAULT 90,
     p_analytics_days  int DEFAULT 365
   )
     RETURNS TABLE(snapshot_refs text[], node_events int, sync_runs int, analytics int)
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
   DECLARE
     v_refs text[];
     v_ne int;
     v_sr int;
     v_ae int;
   BEGIN
     -- Raw snapshots past the window: capture blob refs, detach snapshot-linked provenance (the FK is
     -- RESTRICT), then delete the rows. Provenance keeps its source/confidence; only the raw click-
     -- through (raw_snapshot_id) is nulled.
     SELECT array_agg(storage_ref) INTO v_refs
       FROM raw_snapshots WHERE captured_at < now() - make_interval(days => p_snapshot_days);
     UPDATE provenance SET raw_snapshot_id = NULL
       WHERE raw_snapshot_id IN (
         SELECT id FROM raw_snapshots WHERE captured_at < now() - make_interval(days => p_snapshot_days)
       );
     DELETE FROM raw_snapshots WHERE captured_at < now() - make_interval(days => p_snapshot_days);

     DELETE FROM node_events WHERE occurred_at < now() - make_interval(days => p_node_event_days);
     GET DIAGNOSTICS v_ne = ROW_COUNT;

     DELETE FROM sync_runs
       WHERE finished_at IS NOT NULL AND finished_at < now() - make_interval(days => p_sync_run_days);
     GET DIAGNOSTICS v_sr = ROW_COUNT;

     DELETE FROM analytics_events WHERE created_at < now() - make_interval(days => p_analytics_days);
     GET DIAGNOSTICS v_ae = ROW_COUNT;

     RETURN QUERY SELECT COALESCE(v_refs, '{}'::text[]), v_ne, v_sr, v_ae;
   END
   $$`,
  `REVOKE ALL ON FUNCTION app_purge_expired(int, int, int, int) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_purge_expired(int, int, int, int) TO atlas_app`,
];

export const down: string[] = [`DROP FUNCTION IF EXISTS app_purge_expired(int, int, int, int)`];
