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
// `.env` files (and dotenv) yield "" for a blank `KEY=` line — a *present* empty
// string, which would fail `.url()`/`.min(1)` on an otherwise-optional var. These
// helpers coerce blank/whitespace to `undefined` so "unset" and "set to blank" are
// the same thing (a common, expected operator mistake — fail soft, not at boot).
const blankToUndefined = (v: unknown): unknown =>
  typeof v === "string" && v.trim() === "" ? undefined : v;
const optionalUrl = z.preprocess(blankToUndefined, z.string().url().optional());
const optionalString = z.preprocess(blankToUndefined, z.string().min(1).optional());

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  DATABASE_URL: optionalUrl,
  REDIS_URL: optionalUrl,
  OPENSEARCH_URL: optionalUrl,

  // Supabase Auth (docs/12 §2–3, F1.5). The API verifies user access JWTs against
  // Supabase's JWKS (ES256) — derived from SUPABASE_URL — and mints no tokens of its
  // own. SUPABASE_JWT_SECRET is the HS256 fallback only (projects without asymmetric
  // signing keys). SERVICE_ROLE_KEY is server-only and bypasses RLS (docs/13).
  SUPABASE_URL: optionalUrl,
  SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_JWT_SECRET: optionalString,

  // GitHub App webhook secret (docs/07 §5, docs/13 §5). App-level (one per App), used to
  // HMAC-verify inbound webhooks. Optional: if unset, the webhook endpoint rejects all
  // deliveries (fail-closed) — periodic reconcile still heals the graph (DD-2).
  GITHUB_WEBHOOK_SECRET: optionalString,

  // AES-256-GCM key (32 bytes, hex or base64) for the DB-backed Secrets Broker (docs/13 §7).
  // When set, connector credentials are stored encrypted in `connection_secrets` (durable, so
  // they survive restarts). Unset ⇒ fall back to the in-memory broker (dev-only, wiped on boot).
  SECRET_ENCRYPTION_KEY: optionalString,

  // Auto-refresh cadence: re-sync each connected source whose last sync is older than this many
  // minutes (docs/06 §11, the in-process dev slice of the Scheduler). 0 = disabled. Needs durable
  // secrets (SECRET_ENCRYPTION_KEY) so a sync can resolve credentials without a reconnect.
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(0),

  // Runtime-health poll cadence (operational-intelligence Phase B): cheap read-only checks
  // (ELB target health, ECS counts, RDS status, firing alarms) annotating nodes with
  // attributes.health. Far cheaper than a crawl → can run every couple of minutes.
  // 0 = disabled. Needs durable secrets like the sync scheduler.
  HEALTH_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(0),

  // Browser origin allowed to call the API (CORS). The web app calls the API
  // client-side (Bearer token), so this must list the web origin. Default = local web.
  WEB_ORIGIN: z.string().url().default("http://localhost:4291"),
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
