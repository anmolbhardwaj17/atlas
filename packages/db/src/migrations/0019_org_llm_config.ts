// Per-org LLM config (BYO-LLM, docs/10 §3). Lets an org bring its own model via OpenRouter:
// stores the provider + model + a `secret_ref` pointing at the API key in the encrypted Secrets
// Broker (BR-CONN-1 — the key itself is never here). One row per org. Org-scoped RLS TO atlas_app.

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS org_llm_config (
     org_id     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
     provider   text NOT NULL CHECK (provider IN ('openrouter','anthropic')),
     model      text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 200),
     secret_ref text NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON org_llm_config TO atlas_app`,

  `ALTER TABLE org_llm_config ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_org_llm_config ON org_llm_config`,
  `CREATE POLICY org_scope_org_llm_config ON org_llm_config FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
];
