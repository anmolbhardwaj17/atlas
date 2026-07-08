import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";
import { AskWorkspace } from "@/components/ask/ask-workspace";
import type { ConversationSummary } from "@/lib/browser-api";

export const dynamic = "force-dynamic";

/**
 * A specific conversation by id (docs/09 §5.5) - /ask/:chatId. Renders the same workspace with
 * this conversation pre-opened, so a chat is deep-linkable, reloadable, and back/forward-navigable.
 * The empty-state suggestions aren't needed here (the conversation already has turns).
 */
export default async function AskConversationPage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const shell = await requireShell();
  const { chatId } = await params;
  const convos = await apiGet<ApiOk<ConversationSummary[]>>("/ai/conversations", {
    token: shell.token,
    orgId: shell.orgId,
  });
  const list = convos.body?.data ?? [];
  const title = list.find((c) => c.id === chatId)?.title ?? "Conversation";

  return (
    <>
      <SetBreadcrumbs items={[{ label: "Ask Atlas", href: "/ask" }, { label: title }]} />
      <AskWorkspace
        orgId={shell.orgId}
        suggestions={[]}
        initialConversations={list}
        initialConversationId={chatId}
      />
    </>
  );
}
