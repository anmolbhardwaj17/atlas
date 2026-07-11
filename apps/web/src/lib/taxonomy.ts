import type { LucideIcon } from "lucide-react";
import {
  Crown,
  ShieldCheck,
  User,
  Boxes,
  Package,
  AlertTriangle,
  AlertCircle,
  Info,
} from "lucide-react";

/**
 * Categorical taxonomy - the single source of truth for how enum-typed things are labelled,
 * ordered, coloured, and iconed across the app (roles, environments, providers). Reused so the
 * same category always reads the same way (a "production" chip on the map and a "production"
 * finding on the dashboard share one style). Colour here always encodes a *category*, never
 * decoration - the mono theme still governs chrome; hue is reserved for meaning.
 *
 * Semantic *status* (connected / stale / error) and graph *certainty* (observed / inferred)
 * live in `certainty.tsx` - a different axis (trust/health), intentionally kept separate.
 */

// ── Roles (org RBAC, mirrors @atlas/db `Role`) ──────────────────────────────────
// Ordered by privilege: rank 0 = most powerful. Used for sorting + the RoleBadge.
export type Role = "Owner" | "Admin" | "Member";

export interface RoleMeta {
  label: string;
  /** Privilege rank, 0 = highest. Sort members by this so Owners lead. */
  rank: number;
  icon: LucideIcon;
  /** Tinted badge style - category hue, transparent border (never a hard ring). */
  className: string;
}

// All three constructed identically - transparent border + a clearly-visible tinted fill +
// coloured text - so the row of badges reads as one consistent set (no bare-text outliers).
export const ROLE_META: Record<Role, RoleMeta> = {
  Owner: {
    label: "Owner",
    rank: 0,
    icon: Crown,
    className: "border-transparent bg-amber-500/20 text-amber-700 dark:text-amber-400",
  },
  Admin: {
    label: "Admin",
    rank: 1,
    icon: ShieldCheck,
    className: "border-transparent bg-blue-500/15 text-blue-700 dark:text-blue-400",
  },
  Member: {
    label: "Member",
    rank: 2,
    icon: User,
    className: "border-border bg-transparent text-muted-foreground",
  },
};

export function roleMeta(role: string): RoleMeta {
  return ROLE_META[role as Role] ?? ROLE_META.Member;
}

/** Sort comparator by privilege (Owners first), then by name - for member lists. */
export function byRole<T extends { role: string; name?: string | null; email?: string }>(
  a: T,
  b: T,
): number {
  const d = roleMeta(a.role).rank - roleMeta(b.role).rank;
  if (d !== 0) return d;
  return (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "");
}

// ── Environments (category hue + dot; no brand logo exists for an environment) ──
export interface CategoryStyle {
  /** Text/border/dot hue via a CSS colour token or class hook. */
  text: string;
  /** Selected-chip fill + border. */
  chip: string;
  /** Dot colour (always shown so the category reads even when the chip is off). */
  dot: string;
}

// `chip` = the selected (filled) state - tinted bg + coloured text + TRANSPARENT border
// (never a coloured border; matches the shadcn filled badge). `dot` keeps the category legible.
export const ENV_STYLE: Record<string, CategoryStyle> = {
  prod: {
    text: "text-blue-700 dark:text-blue-400",
    chip: "border-transparent bg-blue-500/18 text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  staging: {
    text: "text-amber-700 dark:text-amber-400",
    chip: "border-transparent bg-amber-500/18 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  dev: {
    text: "text-violet-700 dark:text-violet-400",
    chip: "border-transparent bg-violet-500/18 text-violet-700 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  test: {
    text: "text-cyan-700 dark:text-cyan-400",
    chip: "border-transparent bg-cyan-500/18 text-cyan-700 dark:text-cyan-400",
    dot: "bg-cyan-500",
  },
  unknown: {
    text: "text-slate-600 dark:text-slate-300",
    chip: "border-transparent bg-slate-400/15 text-slate-700 dark:text-slate-300",
    dot: "bg-slate-400",
  },
};

// ── Providers (brand hue + real brand logo key in CLOUD_ICONS) ──────────────────
export interface ProviderMeta {
  /** Brand hue as a hex (brand colours are constants, not theme tokens). */
  brand: string;
  /** Logo key in cloud-icons-data, or a lucide fallback icon for non-brand lanes. */
  logo?: string;
  fallbackIcon?: LucideIcon;
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  aws: { brand: "#FF9900", logo: "aws" },
  azure: { brand: "#0078D4", logo: "microsoft-azure" },
  gcp: { brand: "#1A73E8", logo: "google-cloud" },
  github: { brand: "#24292F", logo: "github-icon" },
  bitbucket: { brand: "#0052CC", logo: "bitbucket" },
  jira: { brand: "#2684FF", logo: "jira" },
  gitlab: { brand: "#FC6D26", logo: "gitlab" },
  datadog: { brand: "#632CA6", logo: "datadog" },
  atlas: { brand: "#111111", fallbackIcon: Boxes },
  external: { brand: "#64748B", fallbackIcon: Package },
};

export function providerMeta(id: string): ProviderMeta | undefined {
  return PROVIDER_META[id];
}

// ── Finding severity (dashboard "needs attention") - semantic, filled, no coloured border ──
export type Severity = "high" | "medium" | "low";

export interface SeverityMeta {
  label: string;
  icon: LucideIcon;
  className: string;
  /** Left-rail accent + dot colour used on the finding row. */
  accent: string;
  /** Text-only colour (for a tile number / row label), matching the badge hue. */
  text: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  high: {
    label: "High",
    icon: AlertTriangle,
    className: "border-transparent bg-red-500/15 text-red-600 dark:text-red-400",
    accent: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
  },
  medium: {
    label: "Medium",
    icon: AlertCircle,
    className: "border-transparent bg-amber-500/20 text-amber-600 dark:text-amber-400",
    accent: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  low: {
    label: "Low",
    icon: Info,
    className: "border-transparent bg-sky-500/15 text-sky-600 dark:text-sky-400",
    accent: "bg-sky-500",
    text: "text-sky-600 dark:text-sky-400",
  },
};

export function severityMeta(s: string): SeverityMeta {
  return SEVERITY_META[s as Severity] ?? SEVERITY_META.low;
}
