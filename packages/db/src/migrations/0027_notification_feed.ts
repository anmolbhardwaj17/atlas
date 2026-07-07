// In-app notification feed (the bell in the top bar). Where notification_channels is the
// OUTBOUND push (Slack), this is the durable INBOX a user opens in the app: one row per
// noteworthy event, org-scoped, marked read when seen. Rows are derived idempotently from
// the change timeline (node_events) via a stable `dedupe_key`, so re-syncing the feed never
// double-inserts. Org-scoped RLS like every data table (R8). Read state is org-level for now
// (a shared inbox) - simple and matches how small teams use it; per-user read can come later.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS notifications (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     kind        text NOT NULL,
     severity    text NOT NULL DEFAULT 'info'
                   CHECK (severity IN ('info','success','warning','danger')),
     title       text NOT NULL,
     body        text,
     href        text,
     dedupe_key  text NOT NULL,
     read_at     timestamptz,
     created_at  timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_notification UNIQUE (org_id, dedupe_key)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_notifications_org_time ON notifications (org_id, created_at DESC)`,
  `ALTER TABLE notifications ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_notifications ON notifications`,
  `CREATE POLICY org_scope_notifications ON notifications FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS notifications`];
