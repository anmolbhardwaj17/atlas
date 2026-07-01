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
  // Monochrome hierarchy: solid = fact, dark outline = strong, gray = weak, dashed = none.
  observed: { label: "observed", className: "border-transparent bg-foreground text-background" },
  "inferred-high": {
    label: "inferred · high",
    className: "border-foreground/50 text-foreground",
  },
  "inferred-low": {
    label: "inferred · low",
    className: "border-muted-foreground/40 text-muted-foreground",
  },
  insufficient: {
    label: "no data",
    className: "border-dashed border-muted-foreground/40 text-muted-foreground",
  },
};
const TIER_FALLBACK: Style = {
  label: "no data",
  className: "border-dashed border-muted-foreground/40 text-muted-foreground",
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
  active: { label: "fresh", className: "border-foreground/40 text-foreground" },
  stale: { label: "stale", className: "border-muted-foreground/40 text-muted-foreground" },
  deleted: {
    label: "removed",
    className: "border-transparent bg-muted text-foreground line-through decoration-1",
  },
};
const FRESH_FALLBACK: Style = {
  label: "unknown",
  className: "border-dashed border-muted-foreground/40 text-muted-foreground",
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
