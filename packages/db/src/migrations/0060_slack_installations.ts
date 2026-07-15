// Slack "Ask Atlas" installation (chat integration). Binds a Slack workspace (`team_id`, globally
// unique) to exactly one Atlas org — the R8 isolation boundary for every inbound slash command. The
// bot token is NOT stored here; only a SecretBroker ref (encrypted at rest, docs/13 §7).
//
// A slash-command request arrives with no Atlas session — we must resolve org from `team_id` BEFORE
// we can set `atlas.current_org`, so that one lookup can't run under org-scoped RLS. `app_slack_org`
// is a SECURITY DEFINER resolver (exactly like `app_connection_org` for the GitHub webhook) that
// returns the bound org for a verified team_id and nothing else. All other access is org-scoped RLS.

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS slack_installations (
     id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     team_id        text NOT NULL,
     team_name      text,
     bot_user_id    text,
     bot_secret_ref text,
     scopes         text,
     installed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at     timestamptz NOT NULL DEFAULT now(),
     updated_at     timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_slack_team UNIQUE (team_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_slack_installations_org ON slack_installations(org_id)`,
  `ALTER TABLE slack_installations ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_slack_installations ON slack_installations`,
  `CREATE POLICY org_scope_slack_installations ON slack_installations FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON slack_installations TO atlas_app`,

  // Pre-auth resolver: verified team_id → bound org. SECURITY DEFINER so it bypasses RLS (the caller
  // has no org context yet), but it returns only the org binding and nothing else about the row.
  `CREATE OR REPLACE FUNCTION app_slack_org(p_team_id text)
     RETURNS uuid
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT org_id FROM slack_installations WHERE team_id = p_team_id
   $$`,
  `REVOKE ALL ON FUNCTION app_slack_org(text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_slack_org(text) TO atlas_app`,
];

export const down: string[] = [
  `DROP FUNCTION IF EXISTS app_slack_org(text)`,
  `DROP TABLE IF EXISTS slack_installations`,
];
