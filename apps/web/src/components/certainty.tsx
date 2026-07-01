import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * The certainty visual language (docs/09 §3.2, FE-1). Observed vs inferred-high vs
 * inferred-low are visually distinct everywhere so trust is always legible (P3/P4/trust
 * is visible). These are the reusable primitives the graph/detail/AI surfaces all use.
 */
interface Style {
  label: string;
  className: string;
}
const TIER: Record<string, Style> = {
  observed: { label: "observed", className: "border-observed/40 text-observed" },
  "inferred-high": {
    label: "inferred · high",
    className: "border-inferred-high/40 text-inferred-high",
  },
  "inferred-low": {
    label: "inferred · low",
    className: "border-inferred-low/40 text-inferred-low",
  },
  insufficient: { label: "no data", className: "border-stale/40 text-stale" },
};
const TIER_FALLBACK: Style = { label: "no data", className: "border-stale/40 text-stale" };

export function ConfidenceBadge({ tier, evidence }: { tier: string; evidence?: string }) {
  const t = TIER[tier] ?? TIER_FALLBACK;
  return (
    <Badge className={t.className} title={evidence ? `${t.label} — ${evidence}` : t.label}>
      {t.label}
    </Badge>
  );
}

const FRESH: Record<string, Style> = {
  active: { label: "fresh", className: "border-observed/40 text-observed" },
  stale: { label: "stale", className: "border-stale/50 text-stale" },
  deleted: { label: "removed", className: "border-danger/40 text-danger" },
};
const FRESH_FALLBACK: Style = { label: "unknown", className: "border-stale/50 text-stale" };

export function FreshnessTag({ status }: { status: string }) {
  const f = FRESH[status] ?? FRESH_FALLBACK;
  return <Badge className={f.className}>{f.label}</Badge>;
}

/** Numbered, clickable source → provenance (P4). Opens the raw evidence in a new tab. */
export function CitationLink({ number, href }: { number: number; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary/15 px-1 align-super text-[10px] font-semibold text-primary hover:bg-primary/25",
      )}
    >
      {number}
    </a>
  );
}
