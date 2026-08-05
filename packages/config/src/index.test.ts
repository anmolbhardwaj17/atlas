import { describe, it, expect } from "vitest";
import { loadEnv } from "./index";

describe("loadEnv", () => {
  it("applies defaults for an empty environment", () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("coerces PORT from a string", () => {
    const env = loadEnv({ PORT: "8080" });
    expect(env.PORT).toBe(8080);
  });

  it("accepts a valid DATABASE_URL", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/atlas" });
    expect(env.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/atlas");
  });

  it("fails fast on an invalid NODE_ENV", () => {
    expect(() => loadEnv({ NODE_ENV: "staging" })).toThrow(/Invalid environment configuration/);
  });

  it("fails fast on a non-numeric PORT", () => {
    expect(() => loadEnv({ PORT: "not-a-number" })).toThrow(/PORT/);
  });

  it("fails fast on a malformed DATABASE_URL", () => {
    expect(() => loadEnv({ DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });

  it("requires prod-critical vars when NODE_ENV=production", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/SECRET_ENCRYPTION_KEY/);
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow(/REDIS_URL/);
  });

  /** The prod-critical set, minus whatever a given case is deliberately omitting. */
  const PROD_BASE = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://user:pass@db:5432/atlas",
    SECRET_ENCRYPTION_KEY: "a".repeat(64),
    REDIS_URL: "redis://redis:6379",
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ANTHROPIC_API_KEY: "sk-ant-test",
  };

  it("accepts a fully-configured production environment", () => {
    const env = loadEnv(PROD_BASE);
    expect(env.NODE_ENV).toBe("production");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test");
  });

  // Without a platform key the AI silently fell back to the dev mock and narrated placeholder prose
  // as if it were an answer — the exact silent-degradation this gate exists to prevent.
  it("requires a platform LLM key in production", () => {
    const { ANTHROPIC_API_KEY: _omitted, ...noKey } = PROD_BASE;
    expect(() => loadEnv(noKey)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("allows a BYO-key-only production deployment when the operator opts in explicitly", () => {
    const { ANTHROPIC_API_KEY: _omitted, ...noKey } = PROD_BASE;
    const env = loadEnv({ ...noKey, ALLOW_BYO_ONLY_LLM: "true" });
    expect(env.ALLOW_BYO_ONLY_LLM).toBe(true);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("leaves dev/test unaffected (optional vars stay optional)", () => {
    expect(() => loadEnv({ NODE_ENV: "test" })).not.toThrow();
  });
});
