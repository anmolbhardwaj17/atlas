// Weekly-digest send ledger (#44). A 7-day setInterval never actually fires — every deploy/restart
// resets it before it reaches 7 days of continuous uptime — and two API instances would double-send.
// So the scheduler ticks hourly and claims the week atomically here: the first caller for a given
// period key inserts the row and sends; everyone else (other instances, later ticks, post-restart
// ticks) sees the conflict and skips. Exactly-once per week across instances and restarts.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS digest_runs (
     period_key text PRIMARY KEY,
     sent_at    timestamptz NOT NULL DEFAULT now()
   )`,

  // Claim a period. Returns true only to the first caller for p_key (which should then send).
  `CREATE OR REPLACE FUNCTION app_claim_digest_period(p_key text)
     RETURNS boolean
     LANGUAGE sql
     SECURITY DEFINER
     SET search_path = public, pg_temp
   AS $$
     WITH ins AS (
       INSERT INTO digest_runs (period_key) VALUES (p_key)
       ON CONFLICT (period_key) DO NOTHING
       RETURNING 1
     )
     SELECT EXISTS (SELECT 1 FROM ins)
   $$`,
  `REVOKE ALL ON FUNCTION app_claim_digest_period(text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION app_claim_digest_period(text) TO atlas_app`,
];

export const down: string[] = [
  `DROP FUNCTION IF EXISTS app_claim_digest_period(text)`,
  `DROP TABLE IF EXISTS digest_runs`,
];
