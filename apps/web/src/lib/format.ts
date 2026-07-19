/**
 * Shared display formatting — the single source for relative time, counts, percentages,
 * pluralization, and the "no value" glyph. Before this, `timeAgo` alone was hand-rolled 8× with
 * divergent behaviour (some copies used Math.round, some rendered a literal "NaNm ago" on a bad
 * date, and the null text / "ago" suffix disagreed screen-to-screen). Route everything through here
 * so numbers and dates read the same on every surface.
 */

/** The single glyph for an empty/absent scalar value. (Distinct from the compliance "N/A" state,
 *  which is a real classification, not a null.) */
export const EMPTY = "—";

/**
 * Relative time: "just now", "5m ago", "3h ago", "2d ago", then a locale date past 30 days.
 * Floor-based and NaN-guarded — an invalid or missing date returns "unknown", never "NaNm ago".
 * Pass `{ suffix: false }` for the compact form ("5m") used in tight spots like the notification badge.
 */
export function timeAgo(iso: string | null | undefined, opts?: { suffix?: boolean }): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const suffix = opts?.suffix === false ? "" : " ago";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${suffix}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${suffix}`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d${suffix}`;
  return new Date(then).toLocaleDateString();
}

/** An integer with locale thousands separators (1234 → "1,234"). Pair with `tabular-nums` in the UI. */
export function formatCount(n: number): string {
  return n.toLocaleString();
}

/** A fraction (0–1) as a rounded percent string; null/undefined → the empty glyph (no-data ≠ 0%). */
export function formatPct(fraction: number | null | undefined): string {
  return fraction == null ? EMPTY : `${Math.round(fraction * 100)}%`;
}

/** The correctly-pluralized noun for a count ("resource" / "resources"). The number is NOT included. */
export function plural(n: number, singular: string, pluralForm: string = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

/** Upper-case the first character of a string. */
export function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}
