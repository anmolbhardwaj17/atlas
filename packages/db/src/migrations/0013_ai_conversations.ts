// AI conversations + messages (docs/10 §9, docs/08 §10.2). Within-session memory is
// persisted so history (GET /ai/conversations/:id) and follow-ups work. Org-scoped (R8):
// the model only ever sees one tenant's data (AE-7). Messages store the assistant's
// citations + overall confidence so the transcript stays cited/tiered (P4/P3).

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE ai_conversations (
     id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
     title       text,
     created_at  timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE ai_messages (
     id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
     role            text NOT NULL CHECK (role IN ('user','assistant')),
     content         text NOT NULL,
     citations       jsonb NOT NULL DEFAULT '[]'::jsonb,
     confidence      text,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_ai_conv_org ON ai_conversations(org_id, created_at DESC)`,
  `CREATE INDEX ix_ai_msg_conv ON ai_messages(conversation_id, created_at)`,

  `ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_ai_conv ON ai_conversations`,
  `CREATE POLICY org_scope_ai_conv ON ai_conversations FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_ai_msg ON ai_messages`,
  `CREATE POLICY org_scope_ai_msg ON ai_messages FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
];

export const down: string[] = [
  `DROP TABLE IF EXISTS ai_messages CASCADE`,
  `DROP TABLE IF EXISTS ai_conversations CASCADE`,
];
