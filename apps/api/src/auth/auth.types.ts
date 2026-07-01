/**
 * Identity Atlas trusts after verifying a Supabase access JWT (docs/12 §2.2, §3).
 * Derived from the token claims — never from request input. `userId` is the
 * Supabase auth uid and equals `public.users.id` (the mirror, docs/12 §2.2).
 */
export interface AuthClaims {
  userId: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  googleSubject: string;
  emailDomain: string | null;
}

import type { Role } from "@atlas/db";

/** Active-org context resolved per request from the caller's membership (docs/12 §4). */
export interface OrgContext {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

/** Minimal request shape the guards read/augment (adapter-agnostic). */
export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  /** Fastify correlation id (from `x-request-id` or generated) — for audit provenance. */
  id?: string;
  auth?: AuthClaims;
  org?: OrgContext;
}
