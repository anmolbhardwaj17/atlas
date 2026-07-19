"use client";

import * as React from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { Loader2, Search, X, Link2, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createEdge, searchNodes, type SearchHit } from "@/lib/browser-api";
import { kindShort } from "@/lib/kind-visual";
import { cn } from "@/lib/cn";

/**
 * "Connect to…" — hand-draw a link from a node to another resource ("fix the flow"). Search-based
 * (not drag-across-canvas) so it works identically whether the target is in the flow or on the
 * bottom shelf, and stays usable at any zoom. Pick a relationship type + search the target →
 * `POST /edges` (a manual, provenance-backed edge). On success the map re-fetches and re-lays out.
 */
const LINK_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "DEPLOYS_TO", label: "Deploys to" },
  { value: "CONNECTS_TO", label: "Connects to" },
  { value: "ROUTES_TO", label: "Routes to" },
  { value: "STORES_IN", label: "Stores in" },
  { value: "DEPENDS_ON", label: "Depends on" },
  { value: "TRIGGERS", label: "Triggers" },
  { value: "IMPLEMENTS", label: "Implements" },
  { value: "USES", label: "Uses" },
];

export function ConnectNodeDialog({
  fromNode,
  orgId,
  onClose,
  onDone,
}: {
  fromNode: { id: string; name: string | null; kind: string };
  orgId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [type, setType] = React.useState<string>("DEPLOYS_TO");
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchHit[]>([]);
  const [target, setTarget] = React.useState<{
    id: string;
    name: string | null;
    kind: string;
  } | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  // Close on Escape, and restore focus to whatever was focused before the dialog opened (a11y:
  // a keyboard user isn't stranded after the modal closes).
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  // Debounced, abortable search; never returns the source node as a target.
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ac = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      void searchNodes(orgId, q, ac.signal)
        .then((hits) => setResults(hits.filter((h) => h.node.id !== fromNode.id)))
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 200);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, orgId, fromNode.id]);

  const submit = async (): Promise<void> => {
    if (!target || submitting) return;
    setSubmitting(true);
    try {
      await createEdge(orgId, fromNode.id, target.id, type);
      toast.success("Link added");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the link.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm duration-150 animate-in fade-in"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Connect resource"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-xl duration-150 animate-in zoom-in-95"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4 text-muted-foreground" />
            Add a link
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* From → [type] → target, the way you'd read the edge. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2 text-xs">
          <span className="max-w-[9rem] truncate rounded bg-background px-2 py-1 font-medium">
            {fromNode.name ?? kindShort(fromNode.kind)}
          </span>
          <ArrowRight className="size-3 text-muted-foreground" />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Relationship type"
            className="rounded border border-border bg-background px-1.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <ArrowRight className="size-3 text-muted-foreground" />
          <span
            className={cn(
              "max-w-[9rem] truncate rounded px-2 py-1",
              target ? "bg-background font-medium" : "text-muted-foreground",
            )}
          >
            {target ? (target.name ?? kindShort(target.kind)) : "choose a target…"}
          </span>
        </div>

        {/* Search the target — works for any node, flow or shelf. */}
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          {searching ? (
            <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : null}
          <Input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setTarget(null);
            }}
            placeholder="Search resources to link…"
            aria-label="Search resources to link"
            className="pl-8"
          />
        </div>

        {results.length > 0 && !target ? (
          <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
            {results.map((h) => (
              <button
                type="button"
                key={h.node.id}
                onClick={() => {
                  setTarget(h.node);
                  setResults([]);
                  setQuery(h.node.name ?? kindShort(h.node.kind));
                }}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {h.node.name ?? <span className="text-muted-foreground">unnamed</span>}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {kindShort(h.node.kind)}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={!target || submitting}>
            {submitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Link2 className="size-3.5" />
            )}
            Add link
          </Button>
        </div>
      </div>
    </div>
  );
}
