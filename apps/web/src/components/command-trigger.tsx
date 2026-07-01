"use client";

/** The clickable ⌘K hint in the top bar; dispatches the same event the palette listens for. */
export function CommandTrigger() {
  return (
    <button
      onClick={() => window.dispatchEvent(new CustomEvent("atlas:open-command"))}
      className="hidden items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-fg sm:flex"
      aria-label="Search (Command-K)"
    >
      <span>Search</span>
      <kbd className="rounded bg-border/60 px-1 font-mono text-[10px]">⌘K</kbd>
    </button>
  );
}
