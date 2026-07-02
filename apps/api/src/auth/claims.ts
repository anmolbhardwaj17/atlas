import type { JWTPayload } from "jose";
import type { AuthClaims } from "./auth.types";

/**
 * Pure mapping from a verified Supabase JWT payload to Atlas's trusted identity
 * (docs/12 §2.2). No I/O - unit-tested. "Parse, don't validate" (docs/16 CS-2):
 * narrows untyped claim values once into a typed `AuthClaims`.
 */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

export function parseAuthClaims(payload: JWTPayload): AuthClaims {
  const claims = payload as Record<string, unknown>;
  const userId = asString(claims.sub);
  const email = asString(claims.email);
  if (!userId) throw new Error("JWT missing sub");
  if (!email) throw new Error("JWT missing email");

  const meta = asRecord(claims.user_metadata);
  // Supabase puts email_verified at the top level and/or in user_metadata.
  const emailVerified = claims.email_verified === true || meta.email_verified === true;
  const name = asString(meta.name) ?? asString(meta.full_name);
  const avatarUrl = asString(meta.avatar_url) ?? asString(meta.picture);
  // The Google subject is stable across email changes; fall back to the Supabase
  // uid so auth_identities.provider_subject (NOT NULL for google) is always set.
  const googleSubject = asString(meta.provider_id) ?? asString(meta.sub) ?? userId;

  return {
    userId,
    email: email.toLowerCase(),
    emailVerified,
    name,
    avatarUrl,
    googleSubject,
    emailDomain: emailDomain(email),
  };
}
