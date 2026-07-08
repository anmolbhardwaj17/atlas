import {
  Activity,
  Cog,
  DollarSign,
  Gauge,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

// Category (pillar) presentation metadata. Lives in a NON-client module so both the client
// InsightsView and the server finding-detail page can import it — a "use client" module's exports
// can't be *called* from a server component (Next.js 15), only rendered/passed as props.

export interface PillarMeta {
  label: string;
  icon: LucideIcon;
  tone: string; // icon/text accent (used on chips + severity-agnostic accents)
  badge: string; // full pill classes for the Category column (tinted bg + inset ring + text)
}

const GENERAL_PILLAR: PillarMeta = {
  label: "General",
  icon: TriangleAlert,
  tone: "text-muted-foreground",
  badge: "bg-muted text-muted-foreground ring-border",
};

// One color enum per category so the Category column reads at a glance. Kept as tasteful tints
// (10% bg + inset ring), not neon, so they sit inside Atlas's mostly-mono surface.
export const PILLAR_META: Record<string, PillarMeta> = {
  security: {
    label: "Security",
    icon: ShieldCheck,
    tone: "text-violet-600 dark:text-violet-400",
    badge: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  },
  reliability: {
    label: "Reliability",
    icon: Activity,
    tone: "text-sky-600 dark:text-sky-400",
    badge: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  },
  cost: {
    label: "Cost",
    icon: DollarSign,
    tone: "text-amber-600 dark:text-amber-400",
    badge: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  },
  performance: {
    label: "Performance",
    icon: Gauge,
    tone: "text-cyan-600 dark:text-cyan-400",
    badge: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
  },
  hygiene: {
    label: "Hygiene",
    icon: Sparkles,
    tone: "text-teal-600 dark:text-teal-400",
    badge: "bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300",
  },
  operations: {
    label: "Operations",
    icon: Cog,
    tone: "text-indigo-600 dark:text-indigo-400",
    badge: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300",
  },
  general: GENERAL_PILLAR,
};

export const pillarMeta = (p?: string): PillarMeta => (p && PILLAR_META[p]) || GENERAL_PILLAR;
