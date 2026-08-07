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
  /**
   * What the tier MEANS, in plain English, for someone who has never read our docs.
   *
   * This is the highest-value text in the product and it was missing entirely. The certainty
   * language is Atlas's whole differentiator — docs/09: "the UI never lies about certainty" — but
   * until now it never *explained* it either. A VP of Engineering seeing `inferred · low` had no
   * way to know whether to act on it, escalate it, or ignore it, and the person who most needs to
   * trust the graph was the one least equipped to decode the taxonomy.
   *
   * Each string says what Atlas knows, how it knows it, and what the reader should DO about it —
   * that last part is what turns a label into a decision.
   */
  meaning: string;
}
const TIER_FALLBACK: TierStyle = {
  label: "no data",
  variant: "outline",
  className: "text-muted-foreground",
  meaning:
    "No data — Atlas has nothing to go on here yet. That's an absence of evidence, not evidence of absence: it may simply be a source that isn't connected.",
};
const TIER: Record<string, TierStyle> = {
  // observed = a green (matches the Atlas AI mark), lightweight badge - not the heavy solid one.
  observed: {
    label: "observed",
    variant: "outline",
    className: "border-transparent bg-success/15 font-normal text-success",
    meaning:
      "Observed — Atlas read this directly from your cloud or code. This is a fact, not a guess. Highest confidence.",
  },
  "inferred-high": {
    label: "inferred · high",
    variant: "secondary",
    meaning:
      "Inferred, high confidence — Atlas worked this out from strong evidence, such as a matching commit SHA or an explicit deploy configuration. Reliable enough to act on, but not directly observed.",
  },
  "inferred-low": {
    label: "inferred · low",
    variant: "outline",
    meaning:
      "Inferred, low confidence — Atlas worked this out from weaker signals such as naming or tags. Treat it as a lead worth verifying, not as a fact.",
  },
  // AI-suggested = a model proposal awaiting the user's confirm/reject — the lowest trust (P3).
  "ai-suggested": {
    label: "AI-suggested",
    variant: "outline",
    className: "border-transparent bg-ai-suggested/15 text-ai-suggested",
    meaning:
      "AI-suggested — a model proposed this link because deterministic matching couldn't find it. Nothing enters your graph until you confirm it.",
  },
  insufficient: TIER_FALLBACK,
  // Advisory = a recommendation grounded in cited facts, not an observed fact itself (P2).
  advisory: {
    label: "recommendation",
    variant: "outline",
    className: "text-primary",
    meaning:
      "Recommendation — Atlas's advice, reasoned from cited facts in your graph. The facts behind it are real; the advice is a judgement.",
  },
};

/** The tier explanations, for surfaces that teach the vocabulary rather than label a single item. */
export const CERTAINTY_GLOSSARY = [
  "observed",
  "inferred-high",
  "inferred-low",
  "ai-suggested",
  "insufficient",
].map((k) => {
  const t = TIER[k] ?? TIER_FALLBACK;
  return { tier: k, label: t.label, meaning: t.meaning };
});

export function ConfidenceBadge({ tier, evidence }: { tier: string; evidence?: string }) {
  const t = TIER[tier] ?? TIER_FALLBACK;
  // Native `title` rather than a Radix tooltip on purpose: this badge renders in lists of hundreds
  // and inside Server Components, so a client-only tooltip would cost real JS and drag the whole
  // module across the RSC boundary for a hover hint.
  return (
    <Badge
      variant={t.variant}
      className={t.className}
      title={evidence ? `${t.meaning}\n\nEvidence: ${evidence}` : t.meaning}
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
