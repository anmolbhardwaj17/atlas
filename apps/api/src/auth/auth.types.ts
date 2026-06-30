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

/** Minimal request shape the guard reads/augments (adapter-agnostic). */
export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthClaims;
}
