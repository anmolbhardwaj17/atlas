// Muted / accepted-risk findings. Insights findings are DERIVED live from the graph (a real fix
// auto-resolves them), so the one thing the graph can't know is a *human decision* to accept or
// dismiss a finding. That's what we persist here, keyed by the stable finding rule id. Org-scoped
// RLS like every data table (R8). Removing the row un-mutes; the finding returns to the active list.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS muted_findings (
     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     finding_id  text NOT NULL,
     reason      text,
     muted_by    uuid,
     muted_at    timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (org_id, finding_id)
   )`,
  `ALTER TABLE muted_findings ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_muted_findings ON muted_findings`,
  `CREATE POLICY org_scope_muted_findings ON muted_findings FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON muted_findings TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS muted_findings`];
