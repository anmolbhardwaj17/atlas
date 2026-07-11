// Incident War Room (docs/plans/war-room.md). A durable, revisitable investigation of a broken node:
// the diagnosis a user opens from a red map node / finding / alert, persisted so it survives the
// session and builds a history ("this broke before"). Sibling to the finding lifecycle, but richer —
// it carries the assembled evidence bundle + the ranked verdict the agentic diagnose loop produced.
// Design: org-scoped RLS (R8) + composite FK to nodes (an incident can't dangle cross-tenant and is
// swept if its node is deleted); at most one OPEN/analyzing incident per node (re-opening the War Room
// reuses it rather than spawning duplicates).

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS incidents (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     node_id     uuid NOT NULL,
     title       text NOT NULL,
     trigger     text NOT NULL CHECK (trigger IN ('map','finding','alert','manual')),
     status      text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','analyzing','resolved','dismissed')),
     severity    text CHECK (severity IS NULL OR severity IN ('high','medium','low')),
     -- The ranked, classified hypotheses the diagnose loop produced (null until diagnosed).
     verdict     jsonb,
     -- The assembled evidence bundle + streamed step trace (citable raw facts, P4).
     evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
     resolution  text,
     opened_by   uuid REFERENCES users(id) ON DELETE SET NULL,
     opened_at   timestamptz NOT NULL DEFAULT now(),
     updated_at  timestamptz NOT NULL DEFAULT now(),
     resolved_at timestamptz,
     CONSTRAINT fk_incident_node FOREIGN KEY (node_id, org_id)
       REFERENCES nodes(id, org_id) ON DELETE CASCADE
   )`,
  `CREATE INDEX IF NOT EXISTS ix_incidents_org_time ON incidents (org_id, opened_at DESC)`,
  `CREATE INDEX IF NOT EXISTS ix_incidents_node ON incidents (node_id, opened_at DESC)`,
  // One live investigation per node — re-opening the War Room reuses the open incident.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_open_per_node ON incidents (org_id, node_id)
     WHERE status IN ('open','analyzing')`,
  `ALTER TABLE incidents ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_incidents ON incidents`,
  `CREATE POLICY org_scope_incidents ON incidents FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON incidents TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS incidents`];
