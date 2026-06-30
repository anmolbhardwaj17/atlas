import { z } from "zod";

/**
 * Atlas environment configuration.
 *
 * Realizes the "parse, don't validate" standard (docs/16 CS-2) and the
 * fail-fast-at-boot config rule (docs/17 §6 / DD-3): untrusted process env is
 * parsed once into a typed, validated `Env` value; downstream code consumes the
 * typed value and never re-checks. An invalid environment throws at startup
 * rather than producing a half-configured runtime.
 *
 * This is the MVP subset; service-specific vars (Google/GitHub/LLM/JWT secret
 * refs, etc.) are added per docs/17 §6.1 as their sprints land.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  OPENSEARCH_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parse and validate environment configuration. Throws a descriptive error
 * listing every invalid field if validation fails (fail-fast, docs/17 §6).
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
