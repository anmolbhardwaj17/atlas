// Durable out-of-tenant deletion sink (compliance close-out). Deleting an org cascade-removes every
// org-scoped row INCLUDING its append-only audit_events — so the org's own audit log can't record its
// deletion (the row dies with the org). This table records each org deletion and OUTLIVES the org:
//
//  - NO foreign key to organizations (a FK would cascade this row away too) — `deleted_org_id` is a
//    bare uuid.
//  - The column is `deleted_org_id`, NOT `org_id`: this is deliberately NOT tenant-scoped (it survives
//    the tenant), so it's excluded from the org-scope RLS-coverage backstop by construction.
//  - Append-only + write-only for the app role: atlas_app may INSERT (the delete path writes it) but
//    has NO SELECT/UPDATE/DELETE — these compliance records are read out-of-band by the owner role, and
//    a tenant can never read another's (or its own vanished) deletion record.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS org_deletion_log (
     id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     deleted_org_id uuid NOT NULL,
     org_slug       text,
     org_name       text,
     actor_user_id  uuid,
     deleted_at     timestamptz NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE org_deletion_log ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS app_insert_org_deletion_log ON org_deletion_log`,
  // INSERT-only policy: the app appends a record; it can never read or mutate the sink.
  `CREATE POLICY app_insert_org_deletion_log ON org_deletion_log FOR INSERT TO atlas_app WITH CHECK (true)`,
  // Migration 0002's DEFAULT PRIVILEGES auto-grant atlas_app SELECT/INSERT/UPDATE/DELETE on every new
  // table — revoke everything and re-grant ONLY INSERT, so a compromised app role still can't read or
  // tamper with deletion records (they're read out-of-band by the owner role).
  `REVOKE ALL ON org_deletion_log FROM atlas_app`,
  `GRANT INSERT ON org_deletion_log TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS org_deletion_log`];
