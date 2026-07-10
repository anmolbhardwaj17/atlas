import { describe, it, expect } from "vitest";
import { SignJWT, type JWTVerifyGetKey } from "jose";
import { loadEnv } from "@atlas/config";
import { SupabaseJwtVerifier } from "./supabase-jwt.verifier";

// Security sweep H4/M2: exercise the HS256 fallback + its hardening WITHOUT a live JWKS endpoint.
// The subclass replaces the remote key set with one that always reports "no matching key", so the
// ES256 primary fails for a key reason and the code falls through to the HS256 path (as it would for
// a project on the legacy shared secret). An HS256 token also trips `algorithms: ["ES256"]` first —
// either way the fallback is what actually verifies it.

const SUPABASE_URL = "https://proj.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const STRONG_SECRET = "s".repeat(40); // ≥32 bytes → fallback enabled

class TestVerifier extends SupabaseJwtVerifier {
  protected override createJwks(): JWTVerifyGetKey {
    return (() => {
      const e = new Error("no matching key") as Error & { code?: string };
      e.code = "ERR_JWKS_NO_MATCHING_KEY";
      return Promise.reject(e);
    }) as unknown as JWTVerifyGetKey;
  }
}

function verifier(secret: string | undefined = STRONG_SECRET): SupabaseJwtVerifier {
  return new TestVerifier(
    loadEnv({
      SUPABASE_URL,
      ...(secret ? { SUPABASE_JWT_SECRET: secret } : {}),
    }),
  );
}

async function hsToken(opts: {
  secret?: string;
  issuer?: string;
  audience?: string;
  expSecondsFromNow?: number;
  email?: string;
}): Promise<string> {
  const key = new TextEncoder().encode(opts.secret ?? STRONG_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: opts.email ?? "user@acme.com", email_verified: true })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-123")
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? "authenticated")
    .setIssuedAt(now)
    .setExpirationTime(now + (opts.expSecondsFromNow ?? 3600))
    .sign(key);
}

describe("SupabaseJwtVerifier", () => {
  it("verifies a well-formed HS256 token (fallback path)", async () => {
    const payload = await verifier().verify(await hsToken({}));
    expect(payload.sub).toBe("user-123");
    expect(payload.email).toBe("user@acme.com");
  });

  it("rejects a token signed with the WRONG secret → 401", async () => {
    await expect(verifier().verify(await hsToken({ secret: "w".repeat(40) }))).rejects.toThrow(
      /Invalid or expired token/,
    );
  });

  it("rejects an EXPIRED token → 401 (never falls through as valid)", async () => {
    await expect(verifier().verify(await hsToken({ expSecondsFromNow: -60 }))).rejects.toThrow(
      /Invalid or expired token/,
    );
  });

  it("rejects a wrong-issuer token → 401", async () => {
    await expect(
      verifier().verify(await hsToken({ issuer: "https://evil.example.com/auth/v1" })),
    ).rejects.toThrow(/Invalid or expired token/);
  });

  it("rejects a wrong-audience token → 401", async () => {
    await expect(verifier().verify(await hsToken({ audience: "anon" }))).rejects.toThrow(
      /Invalid or expired token/,
    );
  });

  it("rejects garbage → 401", async () => {
    await expect(verifier().verify("not.a.jwt")).rejects.toThrow(/Invalid or expired token/);
  });

  it("DISABLES the HS256 fallback when the secret is weak (<32 bytes) → 401 even for a valid sig", async () => {
    const weak = "short"; // 5 chars
    // Sign with the weak secret; the verifier ignores it, so nothing can verify → 401.
    await expect(verifier(weak).verify(await hsToken({ secret: weak }))).rejects.toThrow(
      /Invalid or expired token/,
    );
  });

  it("DISABLES the fallback entirely when no secret is configured → 401", async () => {
    const noSecret = new TestVerifier(loadEnv({ SUPABASE_URL }));
    await expect(noSecret.verify(await hsToken({}))).rejects.toThrow(/Invalid or expired token/);
  });
});
