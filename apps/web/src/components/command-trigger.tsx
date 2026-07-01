"use client";

import { Search } from "lucide-react";

/** The clickable search box in the header; dispatches the event the palette listens for. */
export function CommandTrigger() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("atlas:open-command"))}
      className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      aria-label="Search (Command-K)"
    >
      <Search className="size-4" />
      <span className="hidden sm:inline">Search…</span>
      <kbd className="pointer-events-none ml-2 hidden select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
        ⌘K
      </kbd>
    </button>
  );
}
