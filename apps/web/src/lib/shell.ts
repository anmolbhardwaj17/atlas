import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, apiGet, type ApiOk } from "@/lib/api";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";

/**
 * Server-side guard for authenticated, org-scoped pages (Explore, Ask, Settings).
 * No session → /login. Signed in but no org → home (which shows the create-org card).
 * Returns everything the AppShell + org-scoped `apiGet` calls need.
 */
export interface Shell {
  token: string;
  orgId: string;
  orgName: string;
  role: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface Membership {
  orgId: string;
  orgName: string;
  orgSlug: string;
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
  if (!me || !active) redirect("/");

  return {
    token: session.token,
    orgId: active.orgId,
    orgName: active.orgName,
    role: active.role,
    email: me.email ?? session.email,
    name: me.name,
    avatarUrl: me.avatarUrl,
  };
});
