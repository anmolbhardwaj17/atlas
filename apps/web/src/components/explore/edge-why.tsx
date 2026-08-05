"use client";

import * as React from "react";
import { ChevronDown, Loader2, Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";
import { getEdgeDetail, confirmSuggestedEdge, rejectSuggestedEdge } from "@/lib/browser-api";
import type { EdgeDetail } from "@/lib/graph-types";
import { AI_SUGGESTED_COLOR } from "@/lib/map-types";
import { SuggestionConfidence } from "@/components/map/suggested-links-review";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Inline "why?" for an edge — expands its provenance (origin, rule, source, evidence) right here
 * instead of navigating to a separate page. Lazily fetches the edge detail on first open. For an
 * AI-suggested edge it also offers Confirm / Reject (the human-in-the-loop for AI proposals).
 */
export function EdgeWhy({
  orgId,
  edgeId,
  onResolved,
}: {
  orgId: string;
  edgeId: string;
  /** Called after the user confirms/rejects an AI-suggested edge, so the parent can refresh. */
  onResolved?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<EdgeDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [resolved, setResolved] = React.useState<"confirmed" | "rejected" | null>(null);

  async function confirm() {
    setBusy(true);
    try {
      await confirmSuggestedEdge(orgId, edgeId);
      setResolved("confirmed");
      toast.success("Link confirmed");
      onResolved?.();
    } catch (e) {
      toast.error("Couldn’t confirm", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    try {
      await rejectSuggestedEdge(orgId, edgeId);
      setResolved("rejected");
      toast.success("Suggestion dismissed");
      onResolved?.();
    } catch (e) {
      toast.error("Couldn’t reject", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) {
      setLoading(true);
      setFailed(false);
      try {
        const d = await getEdgeDetail(orgId, edgeId);
        if (d) setDetail(d);
        else setFailed(true);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }
  }

  const evidenceKeys = detail ? Object.keys(detail.evidence ?? {}) : [];

  return (
    <div>
      <button
        type="button"
        onClick={() => void toggle()}
        className="inline-flex items-center gap-1 text-xs text-primary transition-colors hover:underline"
        aria-expanded={open}
      >
        why? <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
          {loading ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading provenance…
            </span>
          ) : detail ? (
            <>
              {detail.origin === "ai_suggested" && !resolved ? (
                <div
                  className="mb-3 rounded-md border p-2.5"
                  style={{
                    borderColor: `${AI_SUGGESTED_COLOR}66`,
                    background: `${AI_SUGGESTED_COLOR}0f`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      <Sparkles className="size-3.5" style={{ color: AI_SUGGESTED_COLOR }} /> Atlas
                      suggests this link
                    </p>
                    <SuggestionConfidence
                      level={
                        typeof detail.evidence?.modelConfidence === "string"
                          ? detail.evidence.modelConfidence
                          : null
                      }
                    />
                  </div>
                  {typeof detail.evidence?.reasoning === "string" ? (
                    <p className="mt-1 text-muted-foreground">{detail.evidence.reasoning}</p>
                  ) : null}
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" onClick={() => void confirm()} disabled={busy}>
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void reject()} disabled={busy}>
                      <X className="size-3.5" /> Reject
                    </Button>
                  </div>
                </div>
              ) : null}
              {resolved ? (
                <p
                  className={cn(
                    "mb-3 rounded-md border border-border bg-background/60 p-2.5 font-medium",
                    resolved === "confirmed" ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {resolved === "confirmed"
                    ? "✓ Confirmed — now a real link."
                    : "Dismissed — Atlas won’t suggest this again."}
                </p>
              ) : null}
              <dl className="space-y-1">
                <WhyRow label="Origin" value={detail.origin} />
                <WhyRow label="Rule" value={detail.rule ?? "— (directly observed)"} />
                <WhyRow label="Source" value={detail.provenance.source ?? "—"} />
                <WhyRow label="Confidence" value={detail.confidence} />
                {detail.provenance.observedAt ? (
                  <WhyRow
                    label="Observed"
                    value={new Date(detail.provenance.observedAt).toLocaleString()}
                  />
                ) : null}
                {evidenceKeys.length > 0 ? (
                  <div className="pt-1">
                    <dt className="mb-0.5 text-muted-foreground">Evidence</dt>
                    <dd className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px]">
                      {JSON.stringify(detail.evidence, null, 2)}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </>
          ) : failed ? (
            <span className="text-muted-foreground">Couldn’t load this edge’s provenance.</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WhyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-right">{value}</dd>
    </div>
  );
}
