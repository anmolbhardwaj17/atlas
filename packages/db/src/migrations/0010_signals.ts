// Signals table (docs/05 §6.3) — structured facts connectors emit alongside nodes
// (SG rules, env vars, endpoints, IAM statements, workflow deploy targets, PR files)
// that the inference engine (G1) consumes to DERIVE edges. Persisted during sync so the
// infer stage — and re-inference on a rule-version bump — can run without re-invoking a
// connector (decoupled from the provider SDKs).
//
// One signal per (org, subject_urn, kind) → upsert refreshes it; reconcile can retire
// signals a re-sync no longer emits (last_sync_run_id gates staleness, like nodes).
// Org-scoped (R8): RLS policy TO atlas_app (Supabase auto-enables RLS on public tables).

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE signals (
     id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     connection_id    uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
     subject_urn      text NOT NULL,
     kind             text NOT NULL,
     data             jsonb NOT NULL DEFAULT '{}'::jsonb,
     first_seen       timestamptz NOT NULL DEFAULT now(),
     last_seen        timestamptz NOT NULL DEFAULT now(),
     last_sync_run_id uuid REFERENCES sync_runs(id),
     CONSTRAINT uq_signal UNIQUE (org_id, subject_urn, kind)
   )`,
  `CREATE INDEX ix_signals_org_kind ON signals(org_id, kind)`,
  `CREATE INDEX ix_signals_subject  ON signals(org_id, subject_urn)`,
  `CREATE INDEX ix_signals_conn     ON signals(org_id, connection_id)`,

  `ALTER TABLE signals ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_signals ON signals`,
  `CREATE POLICY org_scope_signals ON signals FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
];

export const down: string[] = [`DROP TABLE IF EXISTS signals CASCADE`];
