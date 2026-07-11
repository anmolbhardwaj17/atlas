// Proactive-incidents alert policy (docs/plans/proactive-incidents.md). One row per org gating what
// may PROACTIVELY page: 'off' (monitoring only — the map still turns red, but nothing auto-opens an
// incident), 'prod' (only production regressions), 'all'. Default 'prod'. Org-scoped RLS like every
// data table (R8); mirrors the org_llm_config single-row-per-org pattern.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS org_alert_settings (
     org_id     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
     policy     text NOT NULL DEFAULT 'prod' CHECK (policy IN ('off','prod','all')),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE org_alert_settings ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_org_alert_settings ON org_alert_settings`,
  `CREATE POLICY org_scope_org_alert_settings ON org_alert_settings FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON org_alert_settings TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS org_alert_settings`];
