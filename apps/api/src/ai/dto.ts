import { z } from "zod";

export const CreateConversationSchema = z
  .object({ title: z.string().min(1).max(200).optional() })
  .strict();

export const AskSchema = z.object({ message: z.string().min(1).max(2000) }).strict();

/** BYO-LLM config (docs/10 §3). One of OpenRouter / OpenAI (both OpenAI-compatible) or Anthropic.
 *  The key goes to the encrypted Secrets Broker, never persisted in plaintext. */
export const SetLlmConfigSchema = z
  .object({
    provider: z.enum(["openrouter", "openai", "anthropic"]),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1).max(400),
  })
  .strict();
