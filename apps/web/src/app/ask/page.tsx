import { requireShell } from "@/lib/shell";
import { AppShell } from "@/components/app-shell";
import { AskChat } from "@/components/ask/ask-chat";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const shell = await requireShell();
  return (
    <AppShell orgName={shell.orgName} email={shell.email} orgId={shell.orgId}>
      <AskChat orgId={shell.orgId} />
    </AppShell>
  );
}
