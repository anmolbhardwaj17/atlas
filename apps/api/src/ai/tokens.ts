/** DI token for the LLM provider (docs/10 §3) — Claude in prod, mock in dev/CI. */
export const LLM_PROVIDER = Symbol("ATLAS_LLM_PROVIDER");
