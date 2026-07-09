import { redirect } from "next/navigation";
import { getSession, apiGet, type ApiOk } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrgForm } from "./create-org-form";

export const dynamic = "force-dynamic";

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

export default async function HomePage() {
  const session = await getSession();
  // Logged out → the real login page (no separate placeholder landing at `/`).
  if (!session) redirect("/login");

  const me = (await apiGet<ApiOk<MeResponse>>("/me", { token: session.token })).body?.data;
  const active = me?.memberships.find((m) => m.orgId === me.defaultOrgId) ?? me?.memberships[0];

  if (me && active) redirect("/dashboard");

  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to Atlas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Create an organization to start building your graph.
          </p>
          <CreateOrgForm />
        </CardContent>
      </Card>
    </div>
  );
}
