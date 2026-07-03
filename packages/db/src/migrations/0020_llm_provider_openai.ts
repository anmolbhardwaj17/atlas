// Allow direct OpenAI as a BYO-LLM provider (alongside OpenRouter + Anthropic). Users pick which
// of the three to configure. Widen the org_llm_config.provider CHECK. Idempotent (drop+add).

export const up: string[] = [
  `ALTER TABLE org_llm_config DROP CONSTRAINT IF EXISTS org_llm_config_provider_check`,
  `ALTER TABLE org_llm_config ADD CONSTRAINT org_llm_config_provider_check
     CHECK (provider IN ('openrouter','openai','anthropic'))`,
];
