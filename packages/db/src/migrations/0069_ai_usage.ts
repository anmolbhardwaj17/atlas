// Per-org LLM usage ledger + monthly spend cap (deploy-readiness audit, P1).
//
// Before this, Atlas had NO token or cost accounting of any kind. Per-org rate limits bounded how
// OFTEN the AI could be called and `maxTokens` bounded a single response, but nothing bounded total
// spend — and `autoDiagnose` fires automatically off health alerts (up to 2 per notification tick,
// every NOTIFY_INTERVAL_MINUTES). A flapping estate could therefore run up an unbounded bill with no
// human in the loop and no way to see it after the fact.
//
// Design notes:
//  - **Tokens are the ground truth; cost is derived.** `estimated_cost_usd` is computed from a local
//    price table at write time. If a rate goes stale the token columns stay correct.
//  - One row per (org, month, model, key-source) rather than per call: the cap only needs a running
//    total, and an append-per-call table on a chatty estate is a lot of rows to aggregate on every
//    check. `calls` keeps the per-row count for reporting.
//  - **`shared_key` is part of the primary key.** Spend on Atlas's platform key is what the cap
//    protects; a BYO-key org spends its own money and is metered for visibility but not capped.
//    Splitting the rows means the cap query filters instead of subtracting.
//  - `period` is the UTC month as `YYYY-MM` text — cheap to index, unambiguous across timezones, and
//    it makes "this month's spend" a plain equality lookup.

export const up: string[] = [
  `CREATE TABLE IF NOT EXISTS ai_usage (
     org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     period             text NOT NULL,
     model              text NOT NULL,
     shared_key         boolean NOT NULL,
     calls              bigint NOT NULL DEFAULT 0,
     input_tokens       bigint NOT NULL DEFAULT 0,
     output_tokens      bigint NOT NULL DEFAULT 0,
     cache_read_tokens  bigint NOT NULL DEFAULT 0,
     cache_write_tokens bigint NOT NULL DEFAULT 0,
     estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
     updated_at         timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (org_id, period, model, shared_key)
   )`,

  // Org-scoped like every other tenant table (R8) — the RLS-coverage backstop requires it, and a
  // tenant must never see another's spend.
  `ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY`,
  `DROP POLICY IF EXISTS org_scope_ai_usage ON ai_usage`,
  `CREATE POLICY org_scope_ai_usage ON ai_usage FOR ALL TO atlas_app
     USING (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)
     WITH CHECK (org_id = NULLIF(current_setting('atlas.current_org', true), '')::uuid)`,

  // The cap check runs before every AI call, so keep it a single indexed lookup.
  `CREATE INDEX IF NOT EXISTS ix_ai_usage_org_period ON ai_usage (org_id, period) WHERE shared_key`,

  // Atomic accumulate. One statement so concurrent calls (the API and the worker both diagnose)
  // can't lose an update to a read-modify-write race — the cap is only as good as the counter.
  `CREATE OR REPLACE FUNCTION app_record_ai_usage(
     p_org uuid, p_period text, p_model text, p_shared boolean,
     p_in bigint, p_out bigint, p_cache_read bigint, p_cache_write bigint, p_cost numeric
   ) RETURNS void
     LANGUAGE sql
     SECURITY INVOKER
     SET search_path = public, pg_temp
   AS $$
     INSERT INTO ai_usage (org_id, period, model, shared_key, calls,
                           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                           estimated_cost_usd, updated_at)
     VALUES (p_org, p_period, p_model, p_shared, 1,
             p_in, p_out, p_cache_read, p_cache_write, p_cost, now())
     ON CONFLICT (org_id, period, model, shared_key) DO UPDATE SET
       calls              = ai_usage.calls + 1,
       input_tokens       = ai_usage.input_tokens + EXCLUDED.input_tokens,
       output_tokens      = ai_usage.output_tokens + EXCLUDED.output_tokens,
       cache_read_tokens  = ai_usage.cache_read_tokens + EXCLUDED.cache_read_tokens,
       cache_write_tokens = ai_usage.cache_write_tokens + EXCLUDED.cache_write_tokens,
       estimated_cost_usd = ai_usage.estimated_cost_usd + EXCLUDED.estimated_cost_usd,
       updated_at         = now();
   $$`,
];
