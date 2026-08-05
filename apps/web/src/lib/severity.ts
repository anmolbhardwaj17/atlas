/**
 * The one source of truth for severity colour. Before this, every chart + badge hardcoded its own
 * palette, so "medium" and "low" rendered in different hues across the dashboard, insights,
 * compliance, and the War Room. Everything severity-coloured now imports from here.
 *
 * One vivid triad — red (high) → amber (medium) → sky (low) — shared everywhere so severity reads
 * the same on a chart, a chip, a badge, and a finding-row dot. `severityMeta` in taxonomy composes
 * its badge/dot/text from the maps below, so there is exactly ONE severity palette:
 *  - CHART FILLS are concrete hsl() literals (recharts sets `fill` as an SVG attribute, where CSS
 *    `var()` wouldn't resolve). Tuned to stay legible on both the light and dark ground.
 *  - BADGES / TEXT / DOTS use the `--sev-*` tokens (theme-aware) via Tailwind colour classes.
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
  high: "bg-sev-high/10 text-sev-high",
  medium: "bg-sev-medium/10 text-sev-medium",
  low: "bg-sev-low/10 text-sev-low",
};

/** Severity as coloured text (no background). */
export const SEVERITY_TEXT: Record<Severity, string> = {
  high: "text-sev-high",
  medium: "text-sev-medium",
  low: "text-sev-low",
};

/** Severity as a solid dot / left-rail accent fill (the finding-row dot). */
export const SEVERITY_ACCENT: Record<Severity, string> = {
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
};

/** Severity as a bordered, tinted badge (icon + label). The `severityMeta` badge in taxonomy. */
export const SEVERITY_BADGE: Record<Severity, string> = {
  high: "border-transparent bg-sev-high/15 text-sev-high",
  medium: "border-transparent bg-sev-medium/15 text-sev-medium",
  low: "border-transparent bg-sev-low/15 text-sev-low",
};

/** Normalize a loose severity string ("Med", "critical"…) to a canonical tier; unknown → "low". */
export function toSeverity(s: string | null | undefined): Severity {
  const v = (s ?? "").toLowerCase();
  if (v.startsWith("h") || v.startsWith("crit")) return "high";
  if (v.startsWith("m")) return "medium";
  return "low";
}

/**
 * Severity as the raw `--sev-*` TOKEN VALUE (e.g. "var(--sev-high)"), for places that compose a
 * colour in inline CSS — `hsl(var(--sev) / 0.16)` glows, custom properties handed to a child.
 * Tailwind classes can't express those, which is why this returns the token rather than a class.
 *
 * It lives HERE, in a plain module, and deliberately NOT in the "use client" war-room-chrome:
 * the War Room board is a Server Component and calls this during render. A function exported from
 * a "use client" module becomes a client reference, and calling one on the server throws at
 * runtime ("Attempted to call sevHue() from the server but sevHue is on the client") — which
 * neither `tsc` nor `next build` catches, because it's an RSC boundary rule, not a type error.
 */
export const SEVERITY_HUE: Record<Severity, string> = {
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
};

/** Hue token for a loose severity string; unknown/absent → medium (never an invented colour). */
export function sevHue(severity: string | null | undefined): string {
  return severity ? SEVERITY_HUE[toSeverity(severity)] : SEVERITY_HUE.medium;
}
