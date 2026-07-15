/**
 * The one source of truth for severity colour. Before this, every chart + badge hardcoded its own
 * palette, so "medium" and "low" rendered in different hues across the dashboard, insights,
 * compliance, and the War Room. Everything severity-coloured now imports from here.
 *
 * One vivid triad — red (high) → amber (medium) → sky (low) — shared everywhere so severity reads
 * the same on a chart, a chip, and a finding-row dot (matches `severityMeta` in taxonomy):
 *  - CHART FILLS are concrete hsl() literals (recharts sets `fill` as an SVG attribute, where CSS
 *    `var()` wouldn't resolve). Tuned to stay legible on both the light and dark ground.
 *  - BADGES / TEXT use the `--sev-*` tokens (theme-aware) via Tailwind colour classes.
 */
export type Severity = "high" | "medium" | "low";

/** Vivid fill colours for chart `color`/`fill` props (SVG / recharts). Kept in step with `--sev-*`. */
export const SEVERITY_COLOR: Record<Severity, string> = {
  high: "hsl(0 79% 58%)",
  medium: "hsl(35 92% 52%)",
  low: "hsl(200 85% 51%)",
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
