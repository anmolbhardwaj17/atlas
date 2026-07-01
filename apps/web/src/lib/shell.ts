import { redirect } from "next/navigation";
import { getSession, apiGet, type ApiOk } from "@/lib/api";

/**
 * Server-side guard for authenticated, org-scoped pages (Explore, Ask, Settings).
 * No session → /login. Signed in but no org → home (which shows the create-org card).
 * Returns everything the AppShell + org-scoped `apiGet` calls need.
 */
export interface Shell {
  token: string;
  orgId: string;
  orgName: string;
  email: string;
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
  memberships: Membership[];
  defaultOrgId: string | null;
}

export async function requireShell(): Promise<Shell> {
  const session = await getSession();
  if (!session) redirect("/login");

  const me = (await apiGet<ApiOk<MeResponse>>("/me", { token: session.token })).body?.data;
  const active = me?.memberships.find((m) => m.orgId === me.defaultOrgId) ?? me?.memberships[0];
  if (!me || !active) redirect("/");

  return {
    token: session.token,
    orgId: active.orgId,
    orgName: active.orgName,
    email: me.email ?? session.email,
  };
}
