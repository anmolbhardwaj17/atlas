// Consolidate the three per-org 1:1 config satellites — org_profile (0040), org_llm_config
// (0019/0020) and org_alert_settings (0051) — into ONE `org_settings` table (docs/04 §5.7, DD-13).
// Keeps the hot `organizations` row lean while grouping every per-org configuration in one place:
// the onboarding profile, the proactive-alert policy, and BYO-LLM (provider/model + an encrypted
// broker `secret_ref` — never the key itself, BR-CONN-1). ONE row per org, created lazily on first
// write (unchanged behaviour). Org-scoped RLS TO atlas_app like every tenant table (R8).
//
// Backfills from whichever satellites each org actually had, then drops the three. `profile_updated_at`
// preserves the "was an onboarding profile ever captured?" signal that getProfile() returns null for
// (a settings row can now exist because of an alert/LLM write, without a profile).

const ORG_GUC = `NULLIF(current_setting('atlas.current_org', true), '')::uuid`;

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS org_settings (
     org_id             uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
     -- Onboarding profile (disclosed account analytics; docs/12 §6.3, docs/13). Every field optional.
     role               text CHECK (role IS NULL OR char_length(role) <= 40),
     team_size          text CHECK (team_size IS NULL OR char_length(team_size) <= 20),
     use_cases          text[] NOT NULL DEFAULT '{}',
     stack              text[] NOT NULL DEFAULT '{}',
     industry           text CHECK (industry IS NULL OR char_length(industry) <= 60),
     referral_source    text CHECK (referral_source IS NULL OR char_length(referral_source) <= 60),
     profile_updated_at timestamptz,   -- set when the profile is saved; NULL = never captured
     -- Proactive-incidents alert policy (docs/plans/proactive-incidents.md).
     alert_policy       text NOT NULL DEFAULT 'prod' CHECK (alert_policy IN ('off','prod','all')),
     -- BYO-LLM (docs/10 §3): all-or-nothing; secret_ref → encrypted broker, never the key.
     llm_provider       text CHECK (llm_provider IS NULL OR llm_provider IN ('openrouter','openai','anthropic')),
     llm_model          text CHECK (llm_model IS NULL OR char_length(llm_model) BETWEEN 1 AND 200),
     llm_secret_ref     text,
     CONSTRAINT org_settings_llm_all_or_none CHECK (
       (llm_provider IS NULL AND llm_model IS NULL AND llm_secret_ref IS NULL) OR
       (llm_provider IS NOT NULL AND llm_model IS NOT NULL AND llm_secret_ref IS NOT NULL)
     ),
     created_at         timestamptz NOT NULL DEFAULT now(),
     updated_at         timestamptz NOT NULL DEFAULT now()
   )`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON org_settings TO atlas_app`,
  `ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_org_settings ON org_settings`,
  `CREATE POLICY org_scope_org_settings ON org_settings FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,

  // Backfill: one row per org that had at least one satellite (preserves the lazy "no row until
  // first write" semantics the app relies on). Runs as the migration owner, so it sees every org.
  `INSERT INTO org_settings
     (org_id, role, team_size, use_cases, stack, industry, referral_source, profile_updated_at,
      alert_policy, llm_provider, llm_model, llm_secret_ref, created_at, updated_at)
   SELECT o.id,
          p.role, p.team_size, COALESCE(p.use_cases, '{}'::text[]), COALESCE(p.stack, '{}'::text[]),
          p.industry, p.referral_source, p.updated_at,
          COALESCE(a.policy, 'prod'),
          l.provider, l.model, l.secret_ref,
          COALESCE(p.created_at, now()), now()
   FROM organizations o
   LEFT JOIN org_profile        p ON p.org_id = o.id
   LEFT JOIN org_alert_settings a ON a.org_id = o.id
   LEFT JOIN org_llm_config     l ON l.org_id = o.id
   WHERE p.org_id IS NOT NULL OR a.org_id IS NOT NULL OR l.org_id IS NOT NULL
   ON CONFLICT (org_id) DO NOTHING`,

  `DROP TABLE IF EXISTS org_profile`,
  `DROP TABLE IF EXISTS org_alert_settings`,
  `DROP TABLE IF EXISTS org_llm_config`,
];

export const down: string[] = [
  // Best-effort reversal: recreate the three satellites, re-split, then drop org_settings.
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
  `CREATE TABLE IF NOT EXISTS org_alert_settings (
     org_id     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
     policy     text NOT NULL DEFAULT 'prod' CHECK (policy IN ('off','prod','all')),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE org_alert_settings ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_org_alert_settings ON org_alert_settings`,
  `CREATE POLICY org_scope_org_alert_settings ON org_alert_settings FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON org_alert_settings TO atlas_app`,
  `CREATE TABLE IF NOT EXISTS org_llm_config (
     org_id     uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
     provider   text NOT NULL CHECK (provider IN ('openrouter','openai','anthropic')),
     model      text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 200),
     secret_ref text NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON org_llm_config TO atlas_app`,
  `ALTER TABLE org_llm_config ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_org_llm_config ON org_llm_config`,
  `CREATE POLICY org_scope_org_llm_config ON org_llm_config FOR ALL TO atlas_app
     USING (org_id = ${ORG_GUC}) WITH CHECK (org_id = ${ORG_GUC})`,
  `INSERT INTO org_profile (org_id, role, team_size, use_cases, stack, industry, referral_source, created_at, updated_at)
   SELECT org_id, role, team_size, use_cases, stack, industry, referral_source, created_at, COALESCE(profile_updated_at, updated_at)
   FROM org_settings WHERE profile_updated_at IS NOT NULL ON CONFLICT (org_id) DO NOTHING`,
  `INSERT INTO org_alert_settings (org_id, policy, updated_at)
   SELECT org_id, alert_policy, updated_at FROM org_settings WHERE alert_policy <> 'prod' ON CONFLICT (org_id) DO NOTHING`,
  `INSERT INTO org_llm_config (org_id, provider, model, secret_ref, updated_at)
   SELECT org_id, llm_provider, llm_model, llm_secret_ref, updated_at FROM org_settings WHERE llm_provider IS NOT NULL ON CONFLICT (org_id) DO NOTHING`,
  `DROP TABLE IF EXISTS org_settings`,
];
