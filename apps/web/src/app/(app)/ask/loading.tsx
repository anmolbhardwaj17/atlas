/**
 * Route-specific loading fallback for Ask Atlas (`/ask` and `/ask/[chatId]`, since this is the
 * shared parent loader). Mirrors the chat workspace - a recent-conversations sidebar plus a message
 * area and pinned input - so navigation shows a matching skeleton, not a blank wait.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function AskLoading() {
  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[420px] gap-5">
      {/* Recent-conversations sidebar (mirrors AskWorkspace's <aside>). */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border pr-5 md:flex">
        <Skeleton className="mb-2 h-9 w-full" />
        <div className="mb-1 border-t border-border px-1 pb-1 pt-2">
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="flex-1 space-y-0.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </aside>

      {/* Chat pane: message bubbles + input pinned to the bottom (mirrors AskChat). */}
      <div className="min-w-0 flex-1">
        <div className="flex h-full min-h-[420px] flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto pr-1">
            {Array.from({ length: 3 }).map((_, i) => {
              const isUser = i % 2 === 1;
              return isUser ? (
                // User turn: narrower bubble, aligned right.
                <div key={i} className="flex justify-end">
                  <Skeleton className="h-9 w-2/5 rounded-2xl rounded-br-sm" />
                </div>
              ) : (
                // Assistant turn: avatar + a wider block of lines, aligned left.
                <div key={i} className="flex gap-3">
                  <Skeleton className="mt-0.5 size-6 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-11/12" />
                    <Skeleton className="h-4 w-3/5" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input row pinned to the bottom. */}
          <div className="mt-4 flex shrink-0 items-center gap-2 border-t border-border bg-background pt-4">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-20" />
          </div>
        </div>
      </div>
    </div>
  );
}
