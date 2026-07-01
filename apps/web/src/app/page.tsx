import Link from "next/link";
import { getSession, apiGet, type ApiOk } from "@/lib/api";
import { AppShell } from "@/components/app-shell";
import { Dashboard } from "@/components/dashboard";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
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

  if (!me || !active) {
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Welcome to Atlas</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-muted">
              Create an organization to start building your graph.
            </p>
            <CreateOrgForm />
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <AppShell orgName={active.orgName} email={me.email ?? session.email} orgId={active.orgId}>
      <Dashboard orgId={active.orgId} token={session.token} />
    </AppShell>
  );
}

function Landing() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-primary/20 text-2xl font-bold text-primary">
          A
        </div>
        <h1 className="text-2xl font-semibold">Atlas</h1>
        <p className="mt-2 max-w-md text-sm text-muted">
          The knowledge graph is the product. The AI is the interface.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-bg hover:opacity-90"
        >
          Sign in →
        </Link>
      </div>
    </main>
  );
}
