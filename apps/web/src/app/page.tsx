import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, apiGet, type ApiOk } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  if (!session) return <Landing />;

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

function Landing() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-primary text-2xl font-bold text-primary-foreground">
          A
        </div>
        <h1 className="text-2xl font-semibold">Atlas</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The knowledge graph is the product. The AI is the interface.
        </p>
        <Button asChild className="mt-6">
          <Link href="/login">Sign in →</Link>
        </Button>
      </div>
    </main>
  );
}
