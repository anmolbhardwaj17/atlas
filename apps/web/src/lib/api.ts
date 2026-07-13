import { createClient } from "@/lib/supabase/server";
import { apiUrl } from "@/lib/env";

/**
 * Server-side Atlas API client (docs/08). Attaches the caller's Supabase access token and,
 * for org-scoped reads, the `X-Atlas-Org` header (TenantScopeGuard). All reads are
 * server-rendered (secrets stay server-side, NFR-22). Returns the parsed envelope's
 * `data`; on error returns null so pages can render a graceful state (never crash).
 */
export interface Session {
  token: string;
  userId: string;
  email: string;
}

export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return { token: session.access_token, userId: user.id, email: user.email ?? "" };
}

/**
 * The caller's access token straight from the Supabase session cookie — no getUser() network
 * round-trip (unlike getSession() above, which validates against the auth server). The Atlas API
 * validates the JWT itself (ES256/JWKS), so this is safe for org-scoped reads and keeps page
 * navigations network-free (see getPageAuth). Returns null when unauthenticated.
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export interface ApiOk<T> {
  data: T;
  page?: { nextCursor: string | null; hasMore: boolean; limit: number };
}

/** GET an org-scoped endpoint; returns the parsed body or null (with the status). */
export async function apiGet<T>(
  path: string,
  opts: { token: string; orgId?: string },
): Promise<{ body: T | null; status: number }> {
  try {
    const res = await fetch(`${apiUrl()}${path}`, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        ...(opts.orgId ? { "X-Atlas-Org": opts.orgId } : {}),
      },
      cache: "no-store",
    });
    if (!res.ok) return { body: null, status: res.status };
    return { body: (await res.json()) as T, status: res.status };
  } catch {
    return { body: null, status: 0 };
  }
}
