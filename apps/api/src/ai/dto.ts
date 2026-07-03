import { z } from "zod";

export const CreateConversationSchema = z
  .object({ title: z.string().min(1).max(200).optional() })
  .strict();

export const AskSchema = z.object({ message: z.string().min(1).max(2000) }).strict();

/** BYO-LLM config (docs/10 §3). Currently OpenRouter (OpenAI-compatible). The key goes to the
 *  encrypted Secrets Broker, never persisted in plaintext. */
export const SetLlmConfigSchema = z
  .object({
    provider: z.literal("openrouter"),
    model: z.string().trim().min(1).max(200),
    apiKey: z.string().trim().min(1).max(400),
  })
  .strict();
