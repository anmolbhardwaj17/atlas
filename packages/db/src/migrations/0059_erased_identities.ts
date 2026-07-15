// Per-person erasure (GDPR Art. 17 — right to be forgotten; compliance scan follow-up). Erasing a
// person redacts their identity node + scrubs their name from author/assignee/reporter attributes.
// But a re-sync would re-ingest the real name from the source, so the erasure must be DURABLE: this
// table records each erased identity (by stable URN) + the display names to keep scrubbing, and the
// redaction is re-applied after every sync (onSyncComplete). Org-scoped RLS like every data table.

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS erased_identities (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     urn           text NOT NULL,
     display_names text[] NOT NULL DEFAULT '{}',
     erased_by     uuid REFERENCES users(id) ON DELETE SET NULL,
     created_at    timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT uq_erased_identity UNIQUE (org_id, urn)
   )`,
  `CREATE INDEX IF NOT EXISTS ix_erased_identities_org ON erased_identities(org_id)`,
  `ALTER TABLE erased_identities ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_erased_identities ON erased_identities`,
  `CREATE POLICY org_scope_erased_identities ON erased_identities FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON erased_identities TO atlas_app`,
];

export const down: string[] = [`DROP TABLE IF EXISTS erased_identities`];
