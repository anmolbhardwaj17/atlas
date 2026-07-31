"use client";

import * as React from "react";
import { Sparkles, Check, X, Loader2, ArrowRight, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  getSuggestedEdges,
  confirmSuggestedEdge,
  rejectSuggestedEdge,
  suggestAiEdges,
  type SuggestedEdge,
} from "@/lib/browser-api";
import { AI_SUGGESTED_COLOR } from "@/lib/map-types";
import { cn } from "@/lib/cn";

/** How confident the MODEL was about a proposal (its own high/medium/low), rendered as a colour cue
 *  so a reviewer weighs a "low" the model itself flagged differently from a "high". Shared with the
 *  inline edge "why?" panel. Unknown/other values render verbatim, muted. */
export function SuggestionConfidence({
  level,
}: {
  level: string | null;
}): React.JSX.Element | null {
  if (!level) return null;
  const l = level.toLowerCase();
  const tone =
    l === "high"
      ? "text-success border-success/30 bg-success/10"
      : l === "low"
        ? "text-muted-foreground border-border bg-muted/40"
        : "text-warning border-warning/30 bg-warning/10"; // medium / anything else
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
        tone,
      )}
    >
      {l} confidence
    </span>
  );
}

const kindLabel = (kind: string): string =>
  kind.replace(/^aws\.|^github\.|^bitbucket\.|^external\.|^atlas\./, "").replace(/\./g, " ");

/**
 * Map toolbar affordance to REVIEW pending AI-suggested links in one place (docs/10). Suggestions
 * were previously discoverable only by clicking each dotted edge on the canvas; this lists them all
 * with the model's reasoning + confidence and per-row Confirm / Reject, so the human-in-the-loop is
 * a deliberate pass, not a hunt. Self-contained (own fetch/state) so the big map component only
 * mounts it. `onChange` lets the map refresh after a resolution changes the graph.
 */
export function SuggestedLinksReview({
  orgId,
  onChange,
}: {
  orgId: string;
  onChange?: () => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<SuggestedEdge[] | null>(null);
  const [count, setCount] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [finding, setFinding] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = React.useState(false);

  const allSelected = Boolean(items && items.length > 0 && items.every((s) => selected.has(s.id)));
  const toggleOne = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (): void =>
    setSelected(allSelected ? new Set() : new Set((items ?? []).map((s) => s.id)));

  // Advertise the pending count on the button without opening the panel.
  React.useEffect(() => {
    let live = true;
    void getSuggestedEdges(orgId)
      .then((r) => live && setCount(r.length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [orgId]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getSuggestedEdges(orgId);
      setItems(rows);
      setCount(rows.length);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    if (next && !items) await load();
  }

  async function resolve(id: string, action: "confirm" | "reject"): Promise<void> {
    setBusyId(id);
    try {
      if (action === "confirm") await confirmSuggestedEdge(orgId, id);
      else await rejectSuggestedEdge(orgId, id);
      setItems((prev) => (prev ?? []).filter((x) => x.id !== id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setCount((c) => Math.max(0, (c ?? 1) - 1));
      toast.success(action === "confirm" ? "Link confirmed" : "Suggestion dismissed");
      onChange?.();
    } catch (e) {
      toast.error(action === "confirm" ? "Couldn't confirm" : "Couldn't reject", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  /** Confirm/reject every selected suggestion at once (honest partial-failure, like Insights bulk-mute). */
  async function bulkResolve(action: "confirm" | "reject"): Promise<void> {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          action === "confirm" ? confirmSuggestedEdge(orgId, id) : rejectSuggestedEdge(orgId, id),
        ),
      );
      const okIds = new Set(ids.filter((_, i) => results[i]?.status === "fulfilled"));
      const failed = results.length - okIds.size;
      setItems((prev) => (prev ?? []).filter((x) => !okIds.has(x.id)));
      setSelected(new Set());
      setCount((c) => Math.max(0, (c ?? okIds.size) - okIds.size));
      if (okIds.size > 0) {
        toast.success(action === "confirm" ? `Confirmed ${okIds.size}` : `Dismissed ${okIds.size}`);
        onChange?.();
      }
      if (failed > 0) toast.error(`${failed} of ${ids.length} didn't update — try again.`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function findMore(): Promise<void> {
    setFinding(true);
    try {
      const r = await suggestAiEdges(orgId);
      toast.success(
        r.suggested > 0
          ? `Atlas proposed ${r.suggested} new link${r.suggested === 1 ? "" : "s"}.`
          : "No new links to propose right now.",
      );
      await load();
      onChange?.();
    } catch (e) {
      toast.error("Couldn't generate suggestions", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setFinding(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        title="Review AI-suggested repo → runtime links"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
          count && count > 0
            ? "border-transparent"
            : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        )}
        style={
          count && count > 0
            ? { color: AI_SUGGESTED_COLOR, backgroundColor: `${AI_SUGGESTED_COLOR}1F` }
            : undefined
        }
      >
        <Sparkles className="size-3.5" />
        Suggested links
        {count && count > 0 ? (
          <span
            className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-background"
            style={{ backgroundColor: AI_SUGGESTED_COLOR }}
          >
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1.5 max-h-[26rem] w-[22rem] overflow-auto rounded-lg border border-border bg-background/95 p-2 shadow-lg backdrop-blur">
          {loading && !items ? (
            <p className="flex items-center gap-1.5 p-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Loading suggestions…
            </p>
          ) : items && items.length > 0 ? (
            <>
              {/* Select-all + bulk bar — review many at once (honest partial-failure, like Insights). */}
              <div className="mb-1.5 flex items-center justify-between gap-2 px-1 pb-1.5">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--primary)]"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all suggestions"
                  />
                  {selected.size > 0 ? `${selected.size} selected` : "Select all"}
                </label>
                {selected.size > 0 ? (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void bulkResolve("confirm")}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {bulkBusy ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3" />
                      )}
                      Confirm {selected.size}
                    </button>
                    <button
                      type="button"
                      onClick={() => void bulkResolve("reject")}
                      disabled={bulkBusy}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                    >
                      <X className="size-3" /> Reject {selected.size}
                    </button>
                  </div>
                ) : null}
              </div>
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li
                    key={s.id}
                    className="flex gap-2 rounded-md border border-border bg-card/60 p-2.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 size-3.5 shrink-0 accent-[var(--primary)]"
                      checked={selected.has(s.id)}
                      onChange={() => toggleOne(s.id)}
                      aria-label={`Select ${s.from.name ?? "suggestion"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="min-w-0 truncate">
                          {s.from.name ?? kindLabel(s.from.kind)}
                        </span>
                        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 truncate">
                          {s.to.name ?? kindLabel(s.to.kind)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          {kindLabel(s.from.kind)} → {kindLabel(s.to.kind)}
                        </span>
                        <SuggestionConfidence level={s.modelConfidence} />
                      </div>
                      {s.reasoning ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">{s.reasoning}</p>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => void resolve(s.id, "confirm")}
                          disabled={busyId === s.id}
                          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                        >
                          {busyId === s.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Check className="size-3" />
                          )}
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolve(s.id, "reject")}
                          disabled={busyId === s.id}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                        >
                          <X className="size-3" /> Reject
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="p-2 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <Sparkles className="size-3.5" style={{ color: AI_SUGGESTED_COLOR }} />
                No links to review.
              </p>
              <p className="mt-1">
                Atlas can propose repo → runtime links that the naming/tags don't reveal — you
                confirm or reject each.
              </p>
              <button
                type="button"
                onClick={() => void findMore()}
                disabled={finding}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-medium text-foreground transition-colors hover:border-foreground/40 disabled:opacity-60"
              >
                {finding ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wand2 className="size-3.5" />
                )}
                Find links with AI
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
