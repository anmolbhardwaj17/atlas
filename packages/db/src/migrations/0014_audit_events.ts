// Audit log (docs/13 §8). An append-only record of security-relevant actions — who did
// what to which target, in which org, correlated by request id. Org-scoped (R8) like every
// other tenant table. APPEND-ONLY by construction: atlas_app is granted only INSERT + SELECT
// and explicitly REVOKEd UPDATE/DELETE, so the app (even if compromised) cannot rewrite or
// erase history (SEC — tamper-evidence). Retention/rotation is an ops concern (later).

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE audit_events (
     id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     actor_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
     action         text NOT NULL,
     target_type    text,
     target_id      text,
     metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
     request_id     text,
     created_at     timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_audit_org ON audit_events(org_id, created_at DESC)`,

  `ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_audit ON audit_events`,
  // FOR ALL so INSERT's WITH CHECK and SELECT's USING are both org-scoped; the privilege
  // REVOKE below is what actually makes it append-only (UPDATE/DELETE impossible).
  `CREATE POLICY org_scope_audit ON audit_events FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,

  // Append-only: keep INSERT + SELECT, remove mutation privileges (docs/13 §8).
  `GRANT SELECT, INSERT ON audit_events TO atlas_app`,
  `REVOKE UPDATE, DELETE ON audit_events FROM atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS audit_events CASCADE`];
