"use client";

import { useEffect, useState } from "react";
import { Plus, PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { AskChat } from "@/components/ask/ask-chat";
import { deleteConversation, type ConversationSummary } from "@/lib/browser-api";

/**
 * Ask workspace (docs/09 §5.5): a conversation-history sidebar + the chat pane. Past conversations
 * are persisted and reopen with their cited turns; "New chat" starts fresh.
 *
 * Remount discipline: the chat's React `key` changes ONLY when the user explicitly opens a past
 * conversation or starts a new chat — NOT when the current chat creates its conversation mid-stream
 * (that just updates the sidebar). Otherwise a key change would remount the chat and drop the
 * in-flight answer.
 */
export function AskWorkspace({
  orgId,
  initialQuestion,
  suggestions,
  initialConversations,
  initialConversationId,
}: {
  orgId: string;
  initialQuestion?: string | undefined;
  suggestions: string[];
  initialConversations: ConversationSummary[];
  /** From the /ask/:chatId route — open this conversation on load. */
  initialConversationId?: string | undefined;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [highlightId, setHighlightId] = useState<string | null>(initialConversationId ?? null);
  const [epoch, setEpoch] = useState(0); // bumps to force a fresh chat on "New chat"
  const [collapsed, setCollapsed] = useState(false);
  // Right-click context menu for a conversation row (delete).
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const chatKey = conversationId ?? `new-${epoch}`;

  async function removeConversation(id: string) {
    setMenu(null);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (conversationId === id || highlightId === id) newChat();
    await deleteConversation(orgId, id);
  }

  // Conversation row — highlighted in place when it's the one you're viewing (not pinned to top).
  // Right-click opens a small menu with Delete.
  const row = (c: ConversationSummary) => (
    <button
      key={c.id}
      type="button"
      onClick={() => openConversation(c.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ id: c.id, x: e.clientX, y: e.clientY });
      }}
      title={c.title ?? "Untitled"}
      className={cn(
        "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
        highlightId === c.id
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <span className="truncate">{c.title ?? "Untitled"}</span>
    </button>
  );

  function newChat() {
    setConversationId(undefined);
    setEpoch((e) => e + 1);
    setHighlightId(null);
    window.history.pushState(null, "", "/ask");
  }
  function openConversation(id: string) {
    setConversationId(id);
    setHighlightId(id);
    window.history.pushState(null, "", `/ask/${id}`);
  }
  // The current chat created its conversation: reflect it in the sidebar + highlight + URL, but
  // DON'T touch conversationId/epoch — the chat stays mounted so its streaming answer survives.
  // (replaceState updates the address bar via the history API only — no React re-render/remount.)
  function onCreated(id: string, title: string) {
    setConversations((prev) => [{ id, title, createdAt: "" }, ...prev.filter((c) => c.id !== id)]);
    setHighlightId(id);
    window.history.replaceState(null, "", `/ask/${id}`);
  }

  // Keep browser back/forward in sync with the open conversation.
  useEffect(() => {
    const onPop = (): void => {
      const m = window.location.pathname.match(/^\/ask\/([^/]+)/);
      if (m) {
        setConversationId(m[1]);
        setHighlightId(m[1] ?? null);
      } else {
        setConversationId(undefined);
        setHighlightId(null);
        setEpoch((e) => e + 1);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[420px] gap-5">
      {/* Right-click menu (delete a conversation). Backdrop closes it on any outside click. */}
      {menu ? (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="absolute min-w-40 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
            style={{ top: menu.y, left: menu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => void removeConversation(menu.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger hover:bg-danger/10"
            >
              <Trash2 className="size-3.5" /> Delete chat
            </button>
          </div>
        </div>
      ) : null}

      {collapsed ? (
        <aside className="hidden shrink-0 flex-col items-center gap-2 border-r border-border pr-3 md:flex">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Expand chat history"
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <PanelLeftOpen className="size-4" />
          </button>
          <button
            type="button"
            onClick={newChat}
            aria-label="New chat"
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </aside>
      ) : (
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border pr-5 md:flex">
          {/* Header row: fixed height + border-b so its separator aligns with the chat pane's
              title separator (both are h-11 with a bottom border). */}
          <div className="mb-3 flex h-11 items-center gap-1.5 border-b border-border">
            <button
              type="button"
              onClick={newChat}
              className={cn(
                "flex flex-1 items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50",
                highlightId === null && "border-primary/40",
              )}
            >
              <Plus className="size-4" /> New chat
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse chat history"
              className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>
          <div className="mb-1 flex items-center px-1 pb-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Recent
            </span>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</p>
            ) : (
              conversations.map((c) => row(c))
            )}
          </div>
        </aside>
      )}

      <div className="min-w-0 flex-1">
        <AskChat
          key={chatKey}
          orgId={orgId}
          conversationId={conversationId}
          initialQuestion={conversationId ? undefined : initialQuestion}
          suggestions={suggestions}
          onCreated={onCreated}
        />
      </div>
    </div>
  );
}
