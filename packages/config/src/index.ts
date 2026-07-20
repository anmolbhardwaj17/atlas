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

export const EnvSchema = z
  .object({
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

    // Slack "Ask Atlas" chat integration. CLIENT_ID/SECRET drive the OAuth install (workspace ↔ org
    // binding); SIGNING_SECRET HMAC-verifies every inbound slash command (the request signature IS the
    // auth). All optional: unset ⇒ the /slack endpoints reject/no-op (fail-closed), feature simply off.
    SLACK_CLIENT_ID: optionalString,
    SLACK_CLIENT_SECRET: optionalString,
    SLACK_SIGNING_SECRET: optionalString,

    // Discord "Ask Atlas" chat integration (HTTP interactions). APPLICATION_ID doubles as the OAuth
    // client_id; PUBLIC_KEY Ed25519-verifies every inbound interaction (the signature IS the auth);
    // CLIENT_SECRET drives the install OAuth; BOT_TOKEN is for one-time slash-command registration.
    // All optional/fail-closed: unset ⇒ the /discord endpoints reject/no-op, feature simply off.
    DISCORD_APPLICATION_ID: optionalString,
    DISCORD_PUBLIC_KEY: optionalString,
    DISCORD_CLIENT_SECRET: optionalString,
    DISCORD_BOT_TOKEN: optionalString,

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

    // Proactive-notification dispatch cadence (Slack alerts + daily digest). 0 = disabled.
    NOTIFY_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(0),

    // Browser origin allowed to call the API (CORS). The web app calls the API
    // client-side (Bearer token), so this must list the web origin. Default = local web.
    WEB_ORIGIN: z.string().url().default("http://localhost:4291"),

    // Public base URL of THIS API — used to build OAuth redirect URIs that a third party (Slack) posts
    // back to (`/slack/oauth/callback`). Must be the internet-reachable API origin in prod.
    PUBLIC_API_URL: z.string().url().default("http://localhost:4290"),

    // Transactional email (invitations). Resend API key (resend.com). Optional: when unset, invite
    // emails aren't sent — the accept link is logged + surfaced as a copyable link instead, so the
    // flow still works. Send failures are non-fatal (the copy-link is always the fallback).
    RESEND_API_KEY: optionalString,
    // Sender identity for invite emails. Use a verified domain in prod (e.g. "Atlas <team@yourco>");
    // Resend's onboarding sender works out of the box for testing.
    EMAIL_FROM: z.preprocess(
      blankToUndefined,
      z.string().min(1).default("Atlas <onboarding@resend.dev>"),
    ),
  })
  .superRefine((env, ctx) => {
    // Fail-fast in production: these are optional in dev/test (in-memory fallbacks), but their
    // absence in prod means silent degradation — lost secrets on restart (SECRET_ENCRYPTION_KEY),
    // lost jobs on deploy (REDIS_URL), or no DB/auth at all. Require them so a misconfigured prod
    // deploy crashes at boot instead of running broken.
    if (env.NODE_ENV !== "production") return;
    const requiredInProd = [
      "DATABASE_URL",
      "SECRET_ENCRYPTION_KEY",
      "REDIS_URL",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ] as const;
    for (const key of requiredInProd) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when NODE_ENV=production (prod must not silently degrade)`,
        });
      }
    }
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
