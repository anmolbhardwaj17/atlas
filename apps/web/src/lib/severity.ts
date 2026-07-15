/**
 * The one source of truth for severity colour. Before this, every chart + badge hardcoded its own
 * palette, so "medium" and "low" rendered in different hues across the dashboard, insights,
 * compliance, and the War Room. Everything severity-coloured now imports from here.
 *
 * Two tiers, both token-based (mono theme + semantic status hues only):
 *  - CHART FILLS use the muted `--sev-*` data-viz tokens (deliberately desaturated — the dashboard
 *    reads serious, not candy-bright).
 *  - BADGES / TEXT use the brighter semantic status tokens for emphasis (danger / warning), with the
 *    muted slate `--sev-low` for low (an informational, not-alarming tone).
 */
export type Severity = "high" | "medium" | "low";

/** Muted fill colours (the `--sev-*` tokens) for chart `color`/`fill` props (SVG / recharts). */
export const SEVERITY_COLOR: Record<Severity, string> = {
  high: "hsl(4 55% 49%)",
  medium: "hsl(32 48% 46%)",
  low: "hsl(214 18% 55%)",
};

/** Severity as a soft tinted pill — the one badge shape everywhere. */
export const SEVERITY_PILL: Record<Severity, string> = {
  high: "bg-danger/10 text-danger",
  medium: "bg-warning/10 text-warning",
  low: "bg-sev-low/10 text-sev-low",
};

/** Severity as coloured text (no background). */
export const SEVERITY_TEXT: Record<Severity, string> = {
  high: "text-danger",
  medium: "text-warning",
  low: "text-sev-low",
};

/** Normalize a loose severity string ("Med", "critical"…) to a canonical tier; unknown → "low". */
export function toSeverity(s: string | null | undefined): Severity {
  const v = (s ?? "").toLowerCase();
  if (v.startsWith("h") || v.startsWith("crit")) return "high";
  if (v.startsWith("m")) return "medium";
  return "low";
}
