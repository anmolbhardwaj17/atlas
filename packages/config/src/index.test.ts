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

  it("accepts a fully-configured production environment", () => {
    const env = loadEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@db:5432/atlas",
      SECRET_ENCRYPTION_KEY: "a".repeat(64),
      REDIS_URL: "redis://redis:6379",
      SUPABASE_URL: "https://proj.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    });
    expect(env.NODE_ENV).toBe("production");
  });

  it("leaves dev/test unaffected (optional vars stay optional)", () => {
    expect(() => loadEnv({ NODE_ENV: "test" })).not.toThrow();
  });
});
