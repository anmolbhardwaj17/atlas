"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  Cog,
  DollarSign,
  Gauge,
  History,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AtlasAiMark } from "@/components/brand";
import { cn } from "@/lib/cn";

export interface Finding {
  id: string;
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  detail: string;
  href: string | null;
  count?: number;
  guidance: { why: string; fix: string; pillar: string; source: string } | null;
}
export interface InsightsSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  pipelineCoverage: { withPipeline: number; total: number };
}
export interface Mute {
  findingId: string;
  reason: string | null;
  mutedAt: string;
}

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

const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const SEV_TEXT: Record<string, string> = {
  high: "text-danger",
  medium: "text-warning",
  low: "text-inferred-low",
};
const SEV_DOT: Record<string, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-inferred-low",
};

/** Compact relative time for the data-freshness line ("just now", "5m ago", "3h ago", "2d ago"). */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Insights (Atlas Knowledge Engine) - the ADVISORY layer. A scannable posture summary + a dense,
 * filterable findings table; each row opens a detail page with the full guidance, evidence, and
 * lifecycle actions. Findings are derived live from the graph, so a real fix auto-resolves them.
 */
export function InsightsView({
  summary,
  findings,
  mutes = [],
  lastSyncedAt = null,
}: {
  summary: InsightsSummary | null;
  findings: Finding[];
  mutes?: Mute[];
  lastSyncedAt?: string | null;
}) {
  const router = useRouter();
  const mutedSet = React.useMemo(() => new Set(mutes.map((m) => m.findingId)), [mutes]);

  const sorted = React.useMemo(
    () => [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3)),
    [findings],
  );
  // Muted findings are still flagged, but the user chose to accept/dismiss them - keep them out
  // of the active list (their own tab) so the counts reflect what actually needs action.
  const active = React.useMemo(() => sorted.filter((f) => !mutedSet.has(f.id)), [sorted, mutedSet]);
  const muted = React.useMemo(() => sorted.filter((f) => mutedSet.has(f.id)), [sorted, mutedSet]);

  const sevCounts = React.useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const f of active) c[f.severity] += 1;
    return c;
  }, [active]);

  const [tab, setTab] = React.useState<"active" | "muted">("active");
  const base = tab === "muted" ? muted : active;

  const pillars = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of base) {
      const p = f.guidance?.pillar ?? "general";
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [base]);

  const [pillar, setPillar] = React.useState<string>("all");
  const [query, setQuery] = React.useState("");
  const [sev, setSev] = React.useState<"all" | "high" | "medium" | "low">("all");

  const q = query.trim().toLowerCase();
  const shown = base.filter(
    (f) =>
      (pillar === "all" || (f.guidance?.pillar ?? "general") === pillar) &&
      (sev === "all" || f.severity === sev) &&
      (q === "" ||
        f.title.toLowerCase().includes(q) ||
        f.detail.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q)),
  );
  const filtering = pillar !== "all" || sev !== "all" || q !== "";
  const clearFilters = () => {
    setQuery("");
    setSev("all");
    setPillar("all");
  };

  const cov = summary?.pipelineCoverage;
  const covPct = cov && cov.total > 0 ? Math.round((cov.withPipeline / cov.total) * 100) : null;
  const covGap = cov ? cov.total - cov.withPipeline : 0;

  return (
    <div className="w-full space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold">Insights</h1>
          {lastSyncedAt ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <History className="size-3.5" />
              Reflects your sync from {timeAgo(lastSyncedAt)}
            </span>
          ) : null}
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          What to act on - grounded findings with best-practice guidance. Open any one for the full
          fix, evidence, and to track it. Findings are derived live from your graph, so a real fix
          clears them on the next sync.
        </p>
      </header>

      {/* Posture summary: severity tiles + CI/CD coverage. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SeverityTile label="High priority" n={sevCounts.high} sev="high" hint="Fix these first" />
        <SeverityTile label="Medium" n={sevCounts.medium} sev="medium" hint="Worth addressing" />
        <SeverityTile label="Low" n={sevCounts.low} sev="low" hint="Nice to clean up" />
        <Card>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              CI/CD coverage
            </p>
            {covPct !== null ? (
              <>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{covPct}%</p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground transition-all"
                    style={{ width: `${covPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {covGap > 0
                    ? `${covGap} repo${covGap === 1 ? "" : "s"} without a pipeline`
                    : "Every repo has a pipeline."}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No repositories yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active vs muted (accepted-risk). */}
      {muted.length > 0 ? (
        <div className="flex items-center gap-1 border-b border-border">
          <TabButton active={tab === "active"} onClick={() => setTab("active")}>
            Active <span className="text-muted-foreground">{active.length}</span>
          </TabButton>
          <TabButton active={tab === "muted"} onClick={() => setTab("muted")}>
            Muted <span className="text-muted-foreground">{muted.length}</span>
          </TabButton>
        </div>
      ) : null}

      {/* Pillar filter. */}
      {pillars.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <Chip active={pillar === "all"} onClick={() => setPillar("all")}>
            All <span className="text-muted-foreground">{base.length}</span>
          </Chip>
          {pillars.map(([p, n]) => {
            const m = pillarMeta(p);
            return (
              <Chip key={p} active={pillar === p} onClick={() => setPillar(p)}>
                <m.icon className={cn("size-3.5", pillar === p ? "" : m.tone)} /> {m.label}{" "}
                <span className="text-muted-foreground">{n}</span>
              </Chip>
            );
          })}
        </div>
      ) : null}

      {/* Search + severity filter. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search findings…"
            className="h-9 w-full rounded-md border border-border bg-transparent pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/40"
          />
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {(["all", "high", "medium", "low"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSev(s)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                sev === s
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "all" ? "All" : s}
            </button>
          ))}
        </div>
        <p className="text-xs tabular-nums text-muted-foreground sm:ml-auto">
          {shown.length} of {base.length}
        </p>
      </div>

      {/* Findings table - dense + scannable; a row opens its detail page. */}
      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <AtlasAiMark size={28} className="mx-auto mb-3 size-7" />
            <p className="text-sm text-muted-foreground">
              {tab === "muted"
                ? "Nothing muted. Accepted-risk or dismissed findings will collect here."
                : filtering
                  ? "No findings match your search or filters."
                  : active.length === 0
                    ? "Nothing needs attention right now - the graph doesn't flag any issues. You're in good shape."
                    : "No findings here."}
            </p>
            {filtering ? (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-3 text-xs font-medium text-foreground underline-offset-2 hover:underline"
              >
                Clear filters
              </button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="w-24 px-4 py-2.5 font-medium">Severity</th>
                  <th className="px-4 py-2.5 font-medium">Finding</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Category</th>
                  <th className="px-4 py-2.5 text-right font-medium">Affected</th>
                  <th className="w-8 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((it) => {
                  const m = pillarMeta(it.guidance?.pillar);
                  return (
                    <tr
                      key={it.id}
                      onClick={() => router.push(`/insights/${it.id}`)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn("size-2 rounded-full", SEV_DOT[it.severity])} />
                          <span
                            className={cn("text-xs font-medium capitalize", SEV_TEXT[it.severity])}
                          >
                            {it.severity}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/insights/${it.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-foreground hover:underline"
                        >
                          {it.title}
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                            m.badge,
                          )}
                        >
                          <m.icon className="size-3.5" /> {m.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {it.count && it.count > 1 ? it.count : "-"}
                      </td>
                      <td className="px-2 py-3">
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {covGap > 0 ? (
        <Link
          href={`/ask?q=${encodeURIComponent("How do I improve my CI/CD pipeline coverage?")}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Improve CI/CD coverage with Atlas <ArrowRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

function SeverityTile({
  label,
  n,
  sev,
  hint,
}: {
  label: string;
  n: number;
  sev: "high" | "medium" | "low";
  hint: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", SEV_DOT[sev])} />
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
        </div>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums", n > 0 && SEV_TEXT[sev])}>
          {n}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{n > 0 ? hint : "All clear"}</p>
      </CardContent>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
