// Broaden the outbound alert channel beyond Slack. notification_channels already keys on
// (org_id, kind) with one row per kind, so an org can wire Slack + Discord + Teams at once;
// we just relax the kind CHECK. Discord and Microsoft Teams both accept a simple incoming
// webhook POST (same shape as Slack), so no schema change beyond the constraint is needed.

export const up: string[] = [
  `ALTER TABLE notification_channels DROP CONSTRAINT IF EXISTS notification_channels_kind_check`,
  `ALTER TABLE notification_channels
     ADD CONSTRAINT notification_channels_kind_check CHECK (kind IN ('slack','discord','msteams'))`,

  // An org can now have several channel rows; the dispatcher wants each org once per tick.
  `CREATE OR REPLACE FUNCTION app_notification_orgs()
     RETURNS TABLE(org_id uuid)
     LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
   AS $$
     SELECT DISTINCT org_id FROM notification_channels WHERE enabled = true
   $$`,
];

export const down: string[] = [
  `ALTER TABLE notification_channels DROP CONSTRAINT IF EXISTS notification_channels_kind_check`,
  `ALTER TABLE notification_channels
     ADD CONSTRAINT notification_channels_kind_check CHECK (kind IN ('slack'))`,
];
