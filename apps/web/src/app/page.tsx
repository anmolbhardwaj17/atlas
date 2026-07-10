import { redirect } from "next/navigation";
import { getSession, apiGet, type ApiOk } from "@/lib/api";

export const dynamic = "force-dynamic";

interface MeResponse {
  memberships: { orgId: string }[];
  defaultOrgId: string | null;
}

/**
 * The root is a pure router — it renders nothing itself. Three outcomes: logged out → /login; has an
 * org → /dashboard; logged in but org-less → /create-org (the single create surface). The create
 * form used to live inline here, which is why an existing user hitting `/` (e.g. via the switcher's
 * "Create organization") got bounced straight to /dashboard instead of a create form.
 */
export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const me = (await apiGet<ApiOk<MeResponse>>("/me", { token: session.token })).body?.data;
  const active = me?.memberships.find((m) => m.orgId === me.defaultOrgId) ?? me?.memberships[0];

  redirect(active ? "/dashboard" : "/create-org");
}
