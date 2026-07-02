// Connection → org resolver (docs/07 §5). Inbound GitHub webhooks arrive with NO Atlas
// session and NO org context, so the ingress handler can't set the `atlas.current_org`
// GUC before it knows which org a connection belongs to. This SECURITY DEFINER function
// resolves a (non-deleted) connection's org id, bypassing RLS for this single lookup —
// mirrors the auth membership/invitation resolvers (0003/0005). The handler then scopes
// all subsequent work (creating the incremental sync_run) to that org. EXECUTE → atlas_app
// only; never PUBLIC.

export const up: string[] = [
  `CREATE OR REPLACE FUNCTION app_connection_org(p_connection_id uuid)
     RETURNS uuid
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT org_id FROM connections
     WHERE id = p_connection_id AND deleted_at IS NULL
   $$`,
  `REVOKE ALL ON FUNCTION app_connection_org(uuid) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_connection_org(uuid) TO atlas_app`,
];

export const down: string[] = [`DROP FUNCTION IF EXISTS app_connection_org(uuid)`];
