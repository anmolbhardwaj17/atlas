/**
 * Model pricing, for turning reported token usage into an estimated dollar cost (deploy-readiness
 * P1 — the LLM spend cap). Rates are USD per **million** tokens, from Anthropic's published pricing.
 *
 * Why an estimate and not the truth: the provider bills us, not the other way round, so this is a
 * local approximation used to enforce a per-org ceiling and show spend in the UI. It is deliberately
 * conservative — an unknown model falls back to the most expensive rate we know rather than a cheap
 * one, so a model we forgot to list can't quietly bypass the cap.
 *
 * **Tokens are the ground truth.** `ai_usage` stores raw token counts; cost is a derived column. If
 * a rate here is stale, past token counts stay correct and only the dollar estimate drifts.
 *
 * Keeping this current is a maintenance task, not a silent one: `unknown-model` usage is recorded
 * under its real model name, so a model missing from this table is visible in the usage table.
 */

export interface ModelRate {
  /** USD per million input tokens. */
  inputPerMTok: number;
  /** USD per million output tokens. */
  outputPerMTok: number;
}

/**
 * Anthropic first-party rates. Cache reads bill at ~10% of the input rate and 5-minute cache writes
 * at ~125%, applied in `estimateCostUsd` rather than duplicated per model.
 */
const ANTHROPIC_RATES: Record<string, ModelRate> = {
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-mythos-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Charged when the model is unrecognised — the highest rate we know, so unknowns never under-bill. */
const FALLBACK_RATE: ModelRate = { inputPerMTok: 10, outputPerMTok: 50 };

const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Look up a model's rate. Matches the longest known prefix so dated snapshots
 * (`claude-opus-4-5-20251101`) and provider-prefixed ids (`anthropic.claude-opus-5`) resolve to
 * their base model instead of falling through to the expensive default.
 */
export function rateFor(model: string): ModelRate {
  const id = model.toLowerCase();
  let best: { key: string; rate: ModelRate } | null = null;
  for (const [key, rate] of Object.entries(ANTHROPIC_RATES)) {
    if (id.includes(key) && (!best || key.length > best.key.length)) best = { key, rate };
  }
  return best?.rate ?? FALLBACK_RATE;
}

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Estimated USD cost of one model call. Cache reads/writes are priced off the input rate at their
 * respective multipliers; `inputTokens` from the API already EXCLUDES cached tokens, so the three
 * are summed rather than overlapping.
 */
export function estimateCostUsd(model: string, usage: CostInput): number {
  const rate = rateFor(model);
  const perInputToken = rate.inputPerMTok / 1_000_000;
  const perOutputToken = rate.outputPerMTok / 1_000_000;
  return (
    usage.inputTokens * perInputToken +
    usage.outputTokens * perOutputToken +
    (usage.cacheReadTokens ?? 0) * perInputToken * CACHE_READ_MULTIPLIER +
    (usage.cacheWriteTokens ?? 0) * perInputToken * CACHE_WRITE_MULTIPLIER
  );
}
