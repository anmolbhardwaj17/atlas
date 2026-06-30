import { describe, it, expect } from "vitest";
import type { JWTPayload } from "jose";
import { parseAuthClaims, emailDomain } from "./claims";

describe("emailDomain", () => {
  it("extracts and lowercases the domain", () => {
    expect(emailDomain("Anna@Example.COM")).toBe("example.com");
  });
  it("returns null for malformed addresses", () => {
    expect(emailDomain("no-at-sign")).toBeNull();
    expect(emailDomain("trailing@")).toBeNull();
  });
});

describe("parseAuthClaims", () => {
  const base: JWTPayload = {
    sub: "11111111-1111-1111-1111-111111111111",
    aud: "authenticated",
    email: "Dev@Acme.com",
    email_verified: true,
    user_metadata: {
      name: "Dev User",
      avatar_url: "https://img/dev.png",
      provider_id: "google-sub-123",
      email_verified: true,
    },
  } as JWTPayload;

  it("maps a Supabase Google payload to trusted claims", () => {
    const c = parseAuthClaims(base);
    expect(c.userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(c.email).toBe("dev@acme.com");
    expect(c.emailVerified).toBe(true);
    expect(c.name).toBe("Dev User");
    expect(c.avatarUrl).toBe("https://img/dev.png");
    expect(c.googleSubject).toBe("google-sub-123");
    expect(c.emailDomain).toBe("acme.com");
  });

  it("falls back to the Supabase uid when no Google subject is present", () => {
    const c = parseAuthClaims({ ...base, user_metadata: { name: "X" } } as JWTPayload);
    expect(c.googleSubject).toBe(base.sub);
  });

  it("treats a missing/false email_verified as unverified", () => {
    const c = parseAuthClaims({ ...base, email_verified: false, user_metadata: {} } as JWTPayload);
    expect(c.emailVerified).toBe(false);
  });

  it("throws when sub or email is absent (fail closed)", () => {
    expect(() => parseAuthClaims({ aud: "authenticated" } as JWTPayload)).toThrow(/sub/);
    expect(() => parseAuthClaims({ sub: "x" } as JWTPayload)).toThrow(/email/);
  });
});
