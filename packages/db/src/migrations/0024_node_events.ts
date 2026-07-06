// Change timeline (docs/plans/operational-intelligence.md Phase C). The graph answers
// "what is"; node_events answers "what CHANGED, when, by whom" - the raw material of every
// root-cause story (deploys, CloudTrail config changes, PR merges, health transitions).
// Design notes:
//   - Org-scoped RLS like every data table (R8); composite FK to nodes (BR-EDGE-1 pattern)
//     so an event can never dangle cross-tenant, and node deletion sweeps its history.
//   - `dedupe_key` + unique(org_id, dedupe_key) makes ingestion idempotent (CloudTrail
//     re-lookups, poller restarts, backfills - same event lands once).
//   - `title` is the human one-liner shown on timelines; `evidence` carries the citable
//     raw facts (P4). `source` names the system of record.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS node_events (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     node_id     uuid NOT NULL,
     kind        text NOT NULL CHECK (kind IN
                   ('deploy','config_change','pr_merged','alarm_transition','health_transition')),
     occurred_at timestamptz NOT NULL,
     actor       text,
     title       text NOT NULL,
     evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
     source      text NOT NULL,
     dedupe_key  text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT fk_node_event_node FOREIGN KEY (node_id, org_id)
       REFERENCES nodes(id, org_id) ON DELETE CASCADE,
     CONSTRAINT uq_node_event_dedupe UNIQUE (org_id, dedupe_key)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_node_events_node ON node_events (node_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_node_events_org_time ON node_events (org_id, occurred_at DESC)`,
  `ALTER TABLE node_events ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_node_events ON node_events`,
  `CREATE POLICY org_scope_node_events ON node_events FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON node_events TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS node_events`];
