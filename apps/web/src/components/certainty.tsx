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
  active: { label: "fresh", className: "border-success/30 bg-success/10 text-success" },
  stale: { label: "stale", className: "border-warning/30 bg-warning/10 text-warning" },
  deleted: { label: "removed", className: "border-danger/30 bg-danger/10 text-danger" },
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

/**
 * Semantic status badge (docs/09 §3.3) — the one place hue is used in the mono UI:
 * connected/healthy → green, pending/in-progress → amber, error → red, inactive → gray.
 */
const STATUS: Record<string, Style> = {
  connected: { label: "connected", className: "border-success/30 bg-success/10 text-success" },
  succeeded: { label: "succeeded", className: "border-success/30 bg-success/10 text-success" },
  active: { label: "active", className: "border-success/30 bg-success/10 text-success" },
  pending: { label: "pending", className: "border-warning/30 bg-warning/10 text-warning" },
  verifying: { label: "verifying", className: "border-warning/30 bg-warning/10 text-warning" },
  queued: { label: "queued", className: "border-warning/30 bg-warning/10 text-warning" },
  running: { label: "running", className: "border-warning/30 bg-warning/10 text-warning" },
  degraded: { label: "degraded", className: "border-warning/40 bg-warning/10 text-warning" },
  partial: { label: "partial", className: "border-warning/40 bg-warning/10 text-warning" },
  error: { label: "error", className: "border-danger/30 bg-danger/10 text-danger" },
  failed: { label: "failed", className: "border-danger/30 bg-danger/10 text-danger" },
  disconnected: {
    label: "disconnected",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
  },
  cancelled: {
    label: "cancelled",
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? {
    label: status,
    className: "border-muted-foreground/30 bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={s.className}>
      <span className="mr-1 inline-block size-1.5 rounded-full bg-current opacity-80" />
      {s.label}
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
