import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, getAccessToken, apiGet, type ApiOk } from "@/lib/api";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";

/**
 * Server-side guard for authenticated, org-scoped pages (Explore, Ask, Settings).
 * No session → /login. Signed in but no org → /create-org.
 * Returns everything the AppShell + org-scoped `apiGet` calls need.
 */
export interface Shell {
  token: string;
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  role: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /** All of the user's memberships + their default — carried through so the client OrgSwitcher can
   *  hydrate from this render instead of firing its own duplicate `/me` fetch on mount (perf P2a). */
  memberships: Membership[];
  defaultOrgId: string | null;
}

export interface Membership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgLogoUrl: string | null;
  role: string;
}
interface MeResponse {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  memberships: Membership[];
  defaultOrgId: string | null;
}

/**
 * Wrapped in React `cache()` so the layout and its page share a single `/me` fetch
 * within one server render (they both call this), instead of fetching twice per nav.
 */
export const requireShell = cache(async (): Promise<Shell> => {
  const session = await getSession();
  if (!session) redirect("/login");

  const me = (await apiGet<ApiOk<MeResponse>>("/me", { token: session.token })).body?.data;
  // Active org = the switcher's cookie (if it's a real membership) → the user's default → first.
  const picked = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active =
    me?.memberships.find((m) => m.orgId === picked) ??
    me?.memberships.find((m) => m.orgId === me.defaultOrgId) ??
    me?.memberships[0];
  // Signed in but with no org → the create-org surface, directly. This used to redirect to `/`,
  // which forwarded onward; now `/` is the public landing page, so that would have parked an
  // org-less member on marketing copy with no route into the product.
  if (!me || !active) redirect("/create-org");

  return {
    token: session.token,
    orgId: active.orgId,
    orgName: active.orgName,
    orgLogoUrl: active.orgLogoUrl,
    role: active.role,
    email: me.email ?? session.email,
    name: me.name,
    avatarUrl: me.avatarUrl,
    memberships: me.memberships,
    defaultOrgId: me.defaultOrgId,
  };
});

/**
 * Fast, (usually) network-free auth for org-scoped PAGES. Unlike requireShell() it makes no `/me`
 * (or getUser) round-trip: the token comes straight from the session cookie and the org from the
 * active-org cookie (AppShell keeps it in sync — see PersistActiveOrg). This lets a page return its
 * <Suspense> shell immediately, so the destination skeleton shows the instant you navigate instead
 * of after a serial server hop. The LAYOUT still runs the one full requireShell() per load (session
 * validation + the shell UI's identity/memberships).
 *
 * Cold path — the org cookie isn't set yet (a brand-new session before AppShell has mounted) —
 * falls back to requireShell() to resolve the active org. Tenant safety is unchanged: the API
 * enforces membership from the token + X-Atlas-Org (cross-tenant → 404, R8), so a tampered cookie
 * only breaks the tamperer's own page, never leaks another org's data.
 */
export const getPageAuth = cache(async (): Promise<{ token: string; orgId: string }> => {
  const token = await getAccessToken();
  if (!token) redirect("/login");
  const orgId = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  if (orgId) return { token, orgId };
  const shell = await requireShell();
  return { token: shell.token, orgId: shell.orgId };
});
