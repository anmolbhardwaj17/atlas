import { requireShell } from "@/lib/shell";
import { AskChat } from "@/components/ask/ask-chat";

export const dynamic = "force-dynamic";

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const shell = await requireShell();
  const { q } = await searchParams;
  const initial = Array.isArray(q) ? q[0] : q;
  return <AskChat orgId={shell.orgId} initialQuestion={initial} />;
}
