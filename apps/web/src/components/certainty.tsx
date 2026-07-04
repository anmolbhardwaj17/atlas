import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

/**
 * The certainty visual language (docs/09 §3.2, FE-1) + semantic status, built strictly on the
 * official shadcn `Badge` variants - observed = the solid `default` badge, inferred-high = the
 * `secondary` badge, inferred-low / no-data = the `outline` badge. No custom radius or borders;
 * the only additions are the sanctioned semantic status colors (docs/09 §3.3).
 */
type Variant = "default" | "secondary" | "destructive" | "outline";

interface TierStyle {
  label: string;
  variant: Variant;
  className?: string;
}
const TIER_FALLBACK: TierStyle = {
  label: "no data",
  variant: "outline",
  className: "text-muted-foreground",
};
const TIER: Record<string, TierStyle> = {
  // observed = a green (matches the Atlas AI mark), lightweight badge — not the heavy solid one.
  observed: {
    label: "observed",
    variant: "outline",
    className: "border-transparent bg-success/15 font-normal text-success",
  },
  "inferred-high": { label: "inferred · high", variant: "secondary" },
  "inferred-low": { label: "inferred · low", variant: "outline" },
  insufficient: TIER_FALLBACK,
  // Advisory = a recommendation grounded in cited facts, not an observed fact itself (P2).
  advisory: { label: "recommendation", variant: "outline", className: "text-primary" },
};

export function ConfidenceBadge({ tier, evidence }: { tier: string; evidence?: string }) {
  const t = TIER[tier] ?? TIER_FALLBACK;
  return (
    <Badge
      variant={t.variant}
      className={t.className}
      title={evidence ? `${t.label} - ${evidence}` : t.label}
    >
      {t.label}
    </Badge>
  );
}

/**
 * Semantic status color as a soft badge - tinted bg + colored text + TRANSPARENT border,
 * mirroring shadcn's `destructive` badge style (never a colored border).
 */
const SUCCESS = "border-transparent bg-success/10 text-success";
const WARNING = "border-transparent bg-warning/10 text-warning";
const DANGER = "border-transparent bg-danger/10 text-danger";
const NEUTRAL = "border-transparent bg-muted text-muted-foreground";

const FRESH: Record<string, { label: string; className: string }> = {
  active: { label: "fresh", className: SUCCESS },
  stale: { label: "stale", className: WARNING },
  deleted: { label: "removed", className: DANGER },
};

export function FreshnessTag({ status }: { status: string }) {
  const f = FRESH[status] ?? { label: "unknown", className: NEUTRAL };
  return (
    <Badge variant="outline" className={cn("capitalize", f.className)}>
      {f.label}
    </Badge>
  );
}

/**
 * Semantic status badge (docs/09 §3.3) - the one place hue is used in the mono UI:
 * connected/healthy → green, pending/in-progress → amber, error → red, inactive → gray.
 */
const STATUS: Record<string, { label: string; className: string }> = {
  connected: { label: "connected", className: SUCCESS },
  succeeded: { label: "succeeded", className: SUCCESS },
  active: { label: "active", className: SUCCESS },
  accepted: { label: "accepted", className: SUCCESS },
  pending: { label: "pending", className: WARNING },
  invited: { label: "invited", className: WARNING },
  requested: { label: "requested", className: WARNING },
  verifying: { label: "verifying", className: WARNING },
  queued: { label: "queued", className: WARNING },
  running: { label: "running", className: WARNING },
  degraded: { label: "degraded", className: WARNING },
  partial: { label: "partial", className: WARNING },
  error: { label: "error", className: DANGER },
  failed: { label: "failed", className: DANGER },
  revoked: { label: "revoked", className: DANGER },
  disconnected: { label: "disconnected", className: NEUTRAL },
  cancelled: { label: "cancelled", className: NEUTRAL },
  expired: { label: "expired", className: NEUTRAL },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, className: NEUTRAL };
  return (
    <Badge variant="outline" className={cn("capitalize", s.className)}>
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
