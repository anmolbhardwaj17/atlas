import { requireShell } from "@/lib/shell";
import { AskChat } from "@/components/ask/ask-chat";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const shell = await requireShell();
  return <AskChat orgId={shell.orgId} />;
}
