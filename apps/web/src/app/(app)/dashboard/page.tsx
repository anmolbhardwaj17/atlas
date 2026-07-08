import { requireShell } from "@/lib/shell";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const shell = await requireShell();
  return <Dashboard orgId={shell.orgId} token={shell.token} role={shell.role} name={shell.name} />;
}
