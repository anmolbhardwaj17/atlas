"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchNodes, type SearchHit } from "@/lib/browser-api";

/**
 * ⌘K command palette (docs/09 §5.5). One search seam for the human - the same hybrid
 * engine the AI uses for entity resolution. Keyboard-first (⌘K / Ctrl-K to open,
 * ↑↓ to move, ↵ to open, Esc to close); results link into Explore.
 */
export function CommandPalette({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Global open shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("atlas:open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("atlas:open-command", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else {
      setQ("");
      setHits([]);
      setActive(0);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchNodes(orgId, term, ctrl.signal)
        .then((r) => {
          setHits(r);
          setActive(0);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open, orgId]);

  function go(hit: SearchHit | undefined) {
    if (!hit) return;
    setOpen(false);
    router.push(`/explore/${hit.node.id}`);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[15dvh]"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Search resources"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={16} className="text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, hits.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(hits[active]);
              }
            }}
            placeholder="Search resources…"
            className="w-full bg-transparent py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1">
          {q.trim().length >= 2 && hits.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.node.id}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(h)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                    i === active ? "bg-primary/15 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span className="min-w-0 truncate">{h.node.name ?? h.node.id.slice(0, 8)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{h.node.kind}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
