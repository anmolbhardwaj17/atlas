// Discord "Ask Atlas" installation (chat integration). Binds a Discord guild (`guild_id`, globally
// unique) to exactly one Atlas org — the R8 isolation boundary for every inbound interaction. Unlike
// Slack there is NO per-install token: Discord uses one app-level bot token (env), and the answer
// followup is authorized by the interaction token itself, so nothing secret lives in this table.
//
// An interaction arrives with no Atlas session — we resolve org from `guild_id` BEFORE setting
// `atlas.current_org`, so that lookup can't run under org-scoped RLS. `app_discord_org` is a
// SECURITY DEFINER resolver (like `app_slack_org` / `app_connection_org`) returning only the binding.

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS discord_installations (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     guild_id     text NOT NULL,
     guild_name   text,
     installed_by uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at   timestamptz NOT NULL DEFAULT now(),
     updated_at   timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_discord_guild UNIQUE (guild_id)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_discord_installations_org ON discord_installations(org_id)`,
  `ALTER TABLE discord_installations ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_discord_installations ON discord_installations`,
  `CREATE POLICY org_scope_discord_installations ON discord_installations FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON discord_installations TO atlas_app`,

  `CREATE OR REPLACE FUNCTION app_discord_org(p_guild_id text)
     RETURNS uuid
     LANGUAGE sql
     STABLE
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     SELECT org_id FROM discord_installations WHERE guild_id = p_guild_id
   $$`,
  `REVOKE ALL ON FUNCTION app_discord_org(text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_discord_org(text) TO atlas_app`,
];

export const down: string[] = [
  `DROP FUNCTION IF EXISTS app_discord_org(text)`,
  `DROP TABLE IF EXISTS discord_installations`,
];
