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
  observed: { label: "observed", className: "border-observed/30 bg-observed/10 text-observed" },
  "inferred-high": {
    label: "inferred · high",
    className: "border-inferred-high/30 bg-inferred-high/10 text-inferred-high",
  },
  "inferred-low": {
    label: "inferred · low",
    className: "border-inferred-low/30 bg-inferred-low/10 text-inferred-low",
  },
  insufficient: { label: "no data", className: "border-stale/30 bg-stale/10 text-stale" },
};
const TIER_FALLBACK: Style = {
  label: "no data",
  className: "border-stale/30 bg-stale/10 text-stale",
};

export function ConfidenceBadge({ tier, evidence }: { tier: string; evidence?: string }) {
  const t = TIER[tier] ?? TIER_FALLBACK;
  return (
    <Badge
      variant="outline"
      className={t.className}
      title={evidence ? `${t.label} — ${evidence}` : t.label}
    >
      {t.label}
    </Badge>
  );
}

const FRESH: Record<string, Style> = {
  active: { label: "fresh", className: "border-observed/30 bg-observed/10 text-observed" },
  stale: { label: "stale", className: "border-stale/40 bg-stale/10 text-stale" },
  deleted: {
    label: "removed",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};
const FRESH_FALLBACK: Style = {
  label: "unknown",
  className: "border-stale/40 bg-stale/10 text-stale",
};

export function FreshnessTag({ status }: { status: string }) {
  const f = FRESH[status] ?? FRESH_FALLBACK;
  return (
    <Badge variant="outline" className={f.className}>
      {f.label}
    </Badge>
  );
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
