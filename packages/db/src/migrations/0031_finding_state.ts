// Finding lifecycle state. Insights findings are DERIVED live from the graph, so a real fix makes
// a finding simply stop being generated — with nothing persisted, a resolution leaves no trace and
// the user can't see what they've fixed. This table records the lifecycle of each finding (keyed by
// its stable rule id): when it was first/last seen, whether it's currently open or resolved, and
// when it regressed (resolved → seen again). Reconciled by the sync worker after every completed
// sync (the same finding computation the dashboard uses), so timestamps track real data changes.
//
// A snapshot of severity/title/category is stored because a *resolved* finding no longer exists in
// the live graph — we must remember what it was to display it in the "Fixed" history. Org-scoped
// RLS like every data table (R8).

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS finding_state (
     org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     finding_id    text NOT NULL,
     status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
     -- Snapshot of the finding at last-seen, so resolved ones (gone from the live graph) still render.
     severity      text NOT NULL,
     title         text NOT NULL,
     category      text NOT NULL,
     first_seen_at timestamptz NOT NULL DEFAULT now(),
     last_seen_at  timestamptz NOT NULL DEFAULT now(),
     resolved_at   timestamptz,
     regressed_at  timestamptz,
     PRIMARY KEY (org_id, finding_id)
   )`,
  `CREATE INDEX IF NOT EXISTS finding_state_org_status_idx ON finding_state (org_id, status)`,
  `ALTER TABLE finding_state ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_finding_state ON finding_state`,
  `CREATE POLICY org_scope_finding_state ON finding_state FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON finding_state TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS finding_state`];
