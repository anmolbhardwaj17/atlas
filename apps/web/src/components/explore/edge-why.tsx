"use client";

import * as React from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { getEdgeDetail } from "@/lib/browser-api";
import type { EdgeDetail } from "@/lib/graph-types";
import { cn } from "@/lib/cn";

/**
 * Inline "why?" for an edge — expands its provenance (origin, rule, source, evidence) right here
 * instead of navigating to a separate page. Lazily fetches the edge detail on first open.
 */
export function EdgeWhy({ orgId, edgeId }: { orgId: string; edgeId: string }) {
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<EdgeDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

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
