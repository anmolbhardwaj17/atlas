// Connection secrets - durable, encrypted credential storage (docs/13 §7). Replaces the
// in-memory dev broker so credentials survive restarts (connect once, then Fetch latest works
// forever). Material is AES-256-GCM encrypted at rest; the key lives in env (SECRET_ENCRYPTION_KEY),
// never in the DB, so a DB compromise alone can't reveal secrets. BR-CONN-1 holds: connections
// .secret_ref stays a POINTER (`db:<org>:<uuid>`), never the secret itself. Org-scoped RLS TO
// atlas_app (the ref embeds the org so get() can set the GUC). Idempotent (guarded policy drop).

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS connection_secrets (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     ciphertext  text NOT NULL,
     iv          text NOT NULL,
     auth_tag    text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS ix_connection_secrets_org ON connection_secrets(org_id)`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON connection_secrets TO atlas_app`,

  `ALTER TABLE connection_secrets ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_connection_secrets ON connection_secrets`,
  `CREATE POLICY org_scope_connection_secrets ON connection_secrets FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
];
