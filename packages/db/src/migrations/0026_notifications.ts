// Proactive notifications (consumer feature: pull → push). A per-org outbound channel
// (Slack incoming webhook to start) plus two watermarks - one for real-time alerts, one
// for the daily digest - so the dispatcher never repeats itself. Org-scoped RLS like every
// data table. The dispatcher runs with no org context, so app_notification_orgs() lists the
// orgs with an enabled channel across tenants (SECURITY DEFINER, mirrors app_health_targets);
// the dispatcher then org-scopes every read/send.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS notification_channels (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     kind          text NOT NULL CHECK (kind IN ('slack')),
     config        jsonb NOT NULL DEFAULT '{}'::jsonb,
     enabled       boolean NOT NULL DEFAULT true,
     last_alert_at  timestamptz NOT NULL DEFAULT now(),
     last_digest_at timestamptz,
     created_at    timestamptz NOT NULL DEFAULT now(),
     updated_at    timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_notification_channel UNIQUE (org_id, kind)
   )`,
  `ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_notification_channels ON notification_channels`,
  `CREATE POLICY org_scope_notification_channels ON notification_channels FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON notification_channels TO atlas_app`,

  `CREATE OR REPLACE FUNCTION app_notification_orgs()
     RETURNS TABLE(org_id uuid)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
   AS $$
     SELECT org_id FROM notification_channels WHERE enabled = true
   $$`,
  `REVOKE ALL ON FUNCTION app_notification_orgs() FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_notification_orgs() TO atlas_app`,
];

export const down: string[] = [
  `DROP FUNCTION IF EXISTS app_notification_orgs()`,
  `DROP TABLE IF EXISTS notification_channels`,
];
