import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession, apiGet, type ApiOk } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateOrgForm } from "../create-org-form";

export const dynamic = "force-dynamic";

interface MeResponse {
  memberships: { orgId: string }[];
}

/**
 * The single "create an organization" surface. Reachable both by a brand-new org-less user (funneled
 * here from `/`) and by an existing user spinning up a *second* workspace (the org switcher's
 * "Create organization"). Unlike `/`, it never bounces a user who already has an org — that bounce
 * was the bug that made "Create organization" look like it did nothing. Existing users get a "back"
 * escape hatch; org-less users don't (they have nowhere to go back to yet).
 */
export default async function CreateOrgPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const me = (await apiGet<ApiOk<MeResponse>>("/me", { token: session.token })).body?.data;
  const hasOrgs = (me?.memberships.length ?? 0) > 0;

  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 px-6">
      <div className="w-full max-w-md space-y-4">
        {hasOrgs ? (
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to dashboard
          </Link>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>{hasOrgs ? "Create a new organization" : "Welcome to Atlas"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {hasOrgs
                ? "Spin up a separate workspace — its own graph, members, and connections."
                : "Create an organization to start building your graph."}
            </p>
            <CreateOrgForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
