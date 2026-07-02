import type { LucideIcon } from "lucide-react";
import { Crown, ShieldCheck, User, Boxes, Package } from "lucide-react";

/**
 * Categorical taxonomy — the single source of truth for how enum-typed things are labelled,
 * ordered, coloured, and iconed across the app (roles, environments, providers). Reused so the
 * same category always reads the same way (a "production" chip on the map and a "production"
 * finding on the dashboard share one style). Colour here always encodes a *category*, never
 * decoration — the mono theme still governs chrome; hue is reserved for meaning.
 *
 * Semantic *status* (connected / stale / error) and graph *certainty* (observed / inferred)
 * live in `certainty.tsx` — a different axis (trust/health), intentionally kept separate.
 */

// ── Roles (org RBAC, mirrors @atlas/db `Role`) ──────────────────────────────────
// Ordered by privilege: rank 0 = most powerful. Used for sorting + the RoleBadge.
export type Role = "Owner" | "Admin" | "Member";

export interface RoleMeta {
  label: string;
  /** Privilege rank, 0 = highest. Sort members by this so Owners lead. */
  rank: number;
  icon: LucideIcon;
  /** Tinted badge style — category hue, transparent border (never a hard ring). */
  className: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  Owner: {
    label: "Owner",
    rank: 0,
    icon: Crown,
    className: "border-transparent bg-amber-500/12 text-amber-700 dark:text-amber-400",
  },
  Admin: {
    label: "Admin",
    rank: 1,
    icon: ShieldCheck,
    className: "border-transparent bg-blue-500/12 text-blue-700 dark:text-blue-400",
  },
  Member: {
    label: "Member",
    rank: 2,
    icon: User,
    className: "border-transparent bg-muted text-muted-foreground",
  },
};

export function roleMeta(role: string): RoleMeta {
  return ROLE_META[role as Role] ?? ROLE_META.Member;
}

/** Sort comparator by privilege (Owners first), then by name — for member lists. */
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

export const ENV_STYLE: Record<string, CategoryStyle> = {
  prod: {
    text: "text-blue-700 dark:text-blue-400",
    chip: "border-blue-500 bg-blue-500/12 text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  staging: {
    text: "text-amber-700 dark:text-amber-400",
    chip: "border-amber-500 bg-amber-500/12 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  dev: {
    text: "text-violet-700 dark:text-violet-400",
    chip: "border-violet-500 bg-violet-500/12 text-violet-700 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  test: {
    text: "text-cyan-700 dark:text-cyan-400",
    chip: "border-cyan-500 bg-cyan-500/12 text-cyan-700 dark:text-cyan-400",
    dot: "bg-cyan-500",
  },
  unknown: {
    text: "text-slate-600 dark:text-slate-300",
    chip: "border-slate-400 bg-slate-400/12 text-slate-700 dark:text-slate-300",
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
  gitlab: { brand: "#FC6D26", logo: "gitlab" },
  datadog: { brand: "#632CA6", logo: "datadog" },
  atlas: { brand: "#111111", fallbackIcon: Boxes },
  external: { brand: "#64748B", fallbackIcon: Package },
};

export function providerMeta(id: string): ProviderMeta | undefined {
  return PROVIDER_META[id];
}
