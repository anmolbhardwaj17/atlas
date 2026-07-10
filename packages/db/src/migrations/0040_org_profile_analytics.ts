// Onboarding profile + product-analytics events (docs/12 §6.3, docs/04). Two org-scoped tables:
//
//   org_profile — the answers collected when an org is created (creator's role, team size,
//   intended use-cases, self-reported stack, industry, referral source). ONE row per org. This is
//   product/business analytics about the ACCOUNT — a separate, disclosed collection (docs/13),
//   GDPR-deletable (cascades on org delete). Distinct from SEC-10, which governs what we ingest
//   from a customer's cloud/repos into the knowledge graph, not what an account tells us about
//   itself. All columns are nullable/defaulted — every question is optional/skippable.
//
//   analytics_events — an append-only product-analytics event stream for the activation funnel
//   (org.created → onboarding.completed → source.connected → first cited answer). Org-scoped (R8),
//   INSERT+SELECT only for atlas_app (like audit_events) so history can't be rewritten. NOTE:
//   cross-org aggregation for internal analytics runs as the owner role, not atlas_app (RLS keeps
//   each request scoped to its own org).

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  // --- org_profile ---
  `CREATE TABLE IF NOT EXISTS org_profile (
     org_id          uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
     role            text CHECK (role IS NULL OR char_length(role) <= 40),
     team_size       text CHECK (team_size IS NULL OR char_length(team_size) <= 20),
     use_cases       text[] NOT NULL DEFAULT '{}',
     stack           text[] NOT NULL DEFAULT '{}',
     industry        text CHECK (industry IS NULL OR char_length(industry) <= 60),
     referral_source text CHECK (referral_source IS NULL OR char_length(referral_source) <= 60),
     created_at      timestamptz NOT NULL DEFAULT now(),
     updated_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `GRANT SELECT, INSERT, UPDATE ON org_profile TO atlas_app`,
  `ALTER TABLE org_profile ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_org_profile ON org_profile`,
  `CREATE POLICY org_scope_org_profile ON org_profile FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,

  // --- analytics_events (append-only, like audit_events) ---
  `CREATE TABLE IF NOT EXISTS analytics_events (
     id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
     event         text NOT NULL,
     properties    jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at    timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX ix_analytics_org ON analytics_events(org_id, created_at DESC)`,
  `CREATE INDEX ix_analytics_event ON analytics_events(event, created_at DESC)`,
  `ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_analytics ON analytics_events`,
  `CREATE POLICY org_scope_analytics ON analytics_events FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  // Append-only: keep INSERT + SELECT, remove mutation privileges (mirrors audit_events).
  `GRANT SELECT, INSERT ON analytics_events TO atlas_app`,
  `REVOKE UPDATE, DELETE ON analytics_events FROM atlas_app`,
];

export const down: string[] = [
  `DROP TABLE IF EXISTS analytics_events CASCADE`,
  `DROP TABLE IF EXISTS org_profile CASCADE`,
];
