"use client";

import { useState } from "react";
import { Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import { AskChat } from "@/components/ask/ask-chat";
import type { ConversationSummary } from "@/lib/browser-api";

/**
 * Ask workspace (docs/09 §5.5): a conversation-history sidebar + the chat pane. Past
 * conversations are persisted (ai_conversations/ai_messages) and reopen with their cited turns;
 * "New chat" starts fresh. Remounting AskChat on the active id keeps each conversation's state clean.
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
  const [activeId, setActiveId] = useState<string | null>(null);

  function onCreated(id: string, title: string) {
    setConversations((prev) => [{ id, title, createdAt: "" }, ...prev.filter((c) => c.id !== id)]);
    setActiveId(id);
  }

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[420px] gap-5">
      <aside className="hidden w-56 shrink-0 flex-col md:flex">
        <button
          type="button"
          onClick={() => setActiveId(null)}
          className={cn(
            "mb-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50",
            activeId === null && "border-primary/40",
          )}
        >
          <Plus className="size-4" /> New chat
        </button>
        <div className="flex-1 space-y-0.5 overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">No conversations yet.</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                title={c.title ?? "Untitled"}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  activeId === c.id
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <MessageSquare className="size-3.5 shrink-0" />
                <span className="truncate">{c.title ?? "Untitled"}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <AskChat
          key={activeId ?? "new"}
          orgId={orgId}
          conversationId={activeId ?? undefined}
          initialQuestion={activeId ? undefined : initialQuestion}
          suggestions={suggestions}
          onCreated={onCreated}
        />
      </div>
    </div>
  );
}
