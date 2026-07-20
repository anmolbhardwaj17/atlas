// Per-org weekly-digest ledger (backend audit, medium bucket). The original ledger (0048) claimed the
// WHOLE period atomically then looped every org sending — so a crash/restart mid-loop left the period
// marked sent while orgs later in the loop never received that week's digest (a lost week, silently).
//
// This adds a per-(period, org) claim: the send loop claims each org just before sending it, so a
// crash costs at most the single org being processed (the next hourly tick resumes the rest) instead
// of every remaining org. Exactly-once per org per period, across instances and restarts.
//
// The period-level `digest_runs` / `app_claim_digest_period` (0048) stay for back-compat but are no
// longer the gate; the send loop now drives off `app_claim_digest_org`.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS digest_org_runs (
     period_key text NOT NULL,
     org_id     uuid NOT NULL,
     sent_at    timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (period_key, org_id)
   )`,

  // Claim one org for one period. Returns true only to the first caller for (p_key, p_org).
  `CREATE OR REPLACE FUNCTION app_claim_digest_org(p_key text, p_org uuid)
     RETURNS boolean
     LANGUAGE sql
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     WITH ins AS (
       INSERT INTO digest_org_runs (period_key, org_id) VALUES (p_key, p_org)
       ON CONFLICT (period_key, org_id) DO NOTHING
       RETURNING 1
     )
     SELECT EXISTS (SELECT 1 FROM ins)
   $$`,
  `REVOKE ALL ON FUNCTION app_claim_digest_org(text, uuid) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_claim_digest_org(text, uuid) TO atlas_app`,
];

export const down: string[] = [
  `DROP FUNCTION IF EXISTS app_claim_digest_org(text, uuid)`,
  `DROP TABLE IF EXISTS digest_org_runs`,
];
