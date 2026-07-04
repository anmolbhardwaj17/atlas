"use client";

import { useState } from "react";
import { Plus, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { AskChat } from "@/components/ask/ask-chat";
import type { ConversationSummary } from "@/lib/browser-api";

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
}: {
  orgId: string;
  initialQuestion?: string | undefined;
  suggestions: string[];
  initialConversations: ConversationSummary[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0); // bumps to force a fresh chat on "New chat"
  const [collapsed, setCollapsed] = useState(false);

  const chatKey = conversationId ?? `new-${epoch}`;
  // Pin the conversation you're currently in above a "Recent" divider; the rest are history.
  const active = highlightId ? conversations.find((c) => c.id === highlightId) : undefined;
  const past = conversations.filter((c) => c.id !== highlightId);

  const row = (c: ConversationSummary) => (
    <button
      key={c.id}
      type="button"
      onClick={() => openConversation(c.id)}
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
  }
  function openConversation(id: string) {
    setConversationId(id);
    setHighlightId(id);
  }
  // The current chat created its conversation: reflect it in the sidebar + highlight, but DON'T
  // touch conversationId/epoch — the chat stays mounted so its streaming answer survives.
  function onCreated(id: string, title: string) {
    setConversations((prev) => [{ id, title, createdAt: "" }, ...prev.filter((c) => c.id !== id)]);
    setHighlightId(id);
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[420px] gap-5">
      {collapsed ? (
        <aside className="hidden shrink-0 flex-col items-center gap-2 md:flex">
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
        <aside className="hidden w-56 shrink-0 flex-col md:flex">
          <div className="mb-2 flex items-center gap-1.5">
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
          <div className="flex-1 space-y-0.5 overflow-y-auto">
            {active ? (
              <>
                {row(active)}
                <div className="my-2 flex items-center gap-2 px-1">
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Recent
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            ) : null}
            {past.length === 0 && !active ? (
              <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</p>
            ) : (
              past.map((c) => row(c))
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
