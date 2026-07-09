"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, History, RotateCcw, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AtlasAiMark } from "@/components/brand";
import { PostureRadar, type Posture } from "@/components/dashboard/posture-radar";
import { SeverityTrend, type TrendPoint } from "./severity-trend";
import { cn } from "@/lib/cn";
import { severityMeta } from "@/lib/taxonomy";
import { pillarMeta } from "./pillars";

/** Fill any missing pillar with a perfect score so the radar always has all six axes. */
function toPosture(p: Record<string, number>): Posture {
  return {
    security: p.security ?? 100,
    reliability: p.reliability ?? 100,
    cost: p.cost ?? 100,
    performance: p.performance ?? 100,
    hygiene: p.hygiene ?? 100,
    operations: p.operations ?? 100,
  };
}

export interface Finding {
  id: string;
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  detail: string;
  href: string | null;
  count?: number;
  /** Specific affected nodes (deep-link each to /explore/:id), when the finding names them. */
  evidence?: Array<{ id: string; label: string }>;
  guidance: { why: string; fix: string; pillar: string; source: string } | null;
  // Lifecycle overlay (persisted, reconciled each sync).
  firstSeenAt?: string | null;
  regressedAt?: string | null;
  resolvedAt?: string | null;
}
export interface InsightsSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  pipelineCoverage: { withPipeline: number; total: number };
  /** Per-pillar posture (0-100), same computation as the dashboard. */
  posture?: Record<string, number>;
}

/** A pre-filled "ask about this finding" question (grounded, cited answer). */
function findingAskHref(f: Finding): string {
  const q = `How do I fix "${f.title}"? What's affected, why does it matter, and what are the exact steps?`;
  return `/ask?q=${encodeURIComponent(q)}`;
}
export interface Mute {
  findingId: string;
  reason: string | null;
  mutedAt: string;
}

const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

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

/** How long a finding has been open ("open 5d"), or null if under a day (not worth the noise). */
function ageLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  return days >= 1 ? `open ${days}d` : null;
}

/**
 * Insights (Atlas Knowledge Engine) - the ADVISORY layer. A scannable posture summary + a dense,
 * filterable findings table; each row opens a detail page with the full guidance, evidence, and
 * lifecycle actions. Findings are derived live from the graph, so a real fix auto-resolves them.
 */
export function InsightsView({
  summary,
  findings,
  resolved = [],
  mutes = [],
  lastSyncedAt = null,
}: {
  summary: InsightsSummary | null;
  findings: Finding[];
  resolved?: Finding[];
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
  // Fixed history, most-recently-resolved first.
  const resolvedSorted = React.useMemo(
    () => [...resolved].sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")),
    [resolved],
  );

  const sevCounts = React.useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const f of active) c[f.severity] += 1;
    return c;
  }, [active]);

  // Severity trend: reconstruct the open High/Medium/Low counts per day over the window, from each
  // finding's open (firstSeenAt) → close (resolvedAt) lifecycle, so the chart shows movement.
  const trendSeries = React.useMemo<TrendPoint[]>(() => {
    const DAY = 86_400_000;
    const DAYS = 14;
    const today = Math.floor(Date.now() / DAY) * DAY; // start of today (UTC)
    const lived = [...active, ...resolved]; // active = still open; resolved = closed
    const out: TrendPoint[] = [];
    for (let d = DAYS - 1; d >= 0; d--) {
      const start = today - d * DAY;
      const end = start + DAY;
      const c = { high: 0, medium: 0, low: 0 };
      for (const f of lived) {
        const open = f.firstSeenAt ? new Date(f.firstSeenAt).getTime() : null;
        if (open === null || open >= end) continue; // not opened by this day
        const closed = f.resolvedAt ? new Date(f.resolvedAt).getTime() : null;
        if (closed !== null && closed < start) continue; // already closed before this day
        c[f.severity] += 1;
      }
      out.push({ t: start, ...c });
    }
    return out;
  }, [active, resolved]);
  const posture = summary?.posture ?? null;

  const [tab, setTab] = React.useState<"active" | "muted" | "fixed">("active");
  const base = tab === "muted" ? muted : tab === "fixed" ? resolvedSorted : active;

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

  return (
    <div className="w-full space-y-6">
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
          {lastSyncedAt ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
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

      {/* Posture band: severity counts (rows) · how they're trending · the pillar radar. */}
      <div className="grid gap-3 lg:grid-cols-3">
        {/* Left — the three severity counts, stacked. */}
        <div className="grid grid-rows-3 gap-3">
          <SeverityTile label="High" n={sevCounts.high} sev="high" hint="Fix these first" />
          <SeverityTile label="Medium" n={sevCounts.medium} sev="medium" hint="Worth addressing" />
          <SeverityTile label="Low" n={sevCounts.low} sev="low" hint="Nice to clean up" />
        </div>

        {/* Middle — severity trend over time. */}
        <Card>
          <CardContent className="flex h-full flex-col p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Trend
            </p>
            <div className="min-h-0 flex-1">
              <SeverityTrend data={trendSeries} />
            </div>
          </CardContent>
        </Card>

        {/* Right — posture by pillar (same radar as the dashboard). */}
        <Card>
          <CardContent className="flex h-full flex-col p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Posture by area
            </p>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              {posture ? (
                <PostureRadar posture={toPosture(posture)} />
              ) : (
                <p className="text-xs text-muted-foreground/70">No posture data yet.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active / Muted (accepted-risk) / Fixed (resolved history). */}
      {muted.length > 0 || resolvedSorted.length > 0 ? (
        <div className="flex items-center gap-1 border-b border-border">
          <TabButton active={tab === "active"} onClick={() => setTab("active")}>
            Active <span className="text-muted-foreground">{active.length}</span>
          </TabButton>
          {muted.length > 0 ? (
            <TabButton active={tab === "muted"} onClick={() => setTab("muted")}>
              Muted <span className="text-muted-foreground">{muted.length}</span>
            </TabButton>
          ) : null}
          {resolvedSorted.length > 0 ? (
            <TabButton active={tab === "fixed"} onClick={() => setTab("fixed")}>
              Fixed <span className="text-muted-foreground">{resolvedSorted.length}</span>
            </TabButton>
          ) : null}
        </div>
      ) : null}

      {/* Pillar filter (segmented control, matching the Integrations tabs). */}
      {pillars.length > 1 ? (
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted p-1">
          <Chip active={pillar === "all"} onClick={() => setPillar("all")}>
            All <span className="text-muted-foreground">{base.length}</span>
          </Chip>
          {pillars.map(([p, n]) => {
            const m = pillarMeta(p);
            return (
              <Chip key={p} active={pillar === p} onClick={() => setPillar(p)}>
                <m.icon className={cn("size-3.5", pillar === p ? m.tone : "")} /> {m.label}{" "}
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
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted p-1">
          {(["all", "high", "medium", "low"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSev(s)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                sev === s
                  ? "bg-background text-foreground shadow-sm"
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
                : tab === "fixed"
                  ? "No fixed findings yet. Once a finding clears on a sync, it lands here with when it was resolved."
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
                  <th className="w-24 px-4 py-2.5 font-medium">
                    {tab === "fixed" ? "Status" : "Severity"}
                  </th>
                  <th className="px-4 py-2.5 font-medium">Finding</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Category</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    {tab === "fixed" ? "Fixed" : "Affected"}
                  </th>
                  <th className="w-16 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((it) => {
                  const m = pillarMeta(it.guidance?.pillar);
                  const isFixed = tab === "fixed";
                  const age = ageLabel(it.firstSeenAt);
                  return (
                    <tr
                      key={it.id}
                      onClick={isFixed ? undefined : () => router.push(`/insights/${it.id}`)}
                      className={cn(
                        "align-top transition-colors",
                        isFixed ? "" : "cursor-pointer hover:bg-muted/40",
                      )}
                    >
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              "size-2 rounded-full",
                              isFixed ? "bg-success" : severityMeta(it.severity).accent,
                            )}
                          />
                          <span
                            className={cn(
                              "text-xs font-medium capitalize",
                              isFixed ? "text-success" : severityMeta(it.severity).text,
                            )}
                          >
                            {isFixed ? "Fixed" : it.severity}
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isFixed ? (
                          <span className="font-medium text-muted-foreground line-through decoration-muted-foreground/40">
                            {it.title}
                          </span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <Link
                              href={`/insights/${it.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-foreground hover:underline"
                            >
                              {it.title}
                            </Link>
                            {it.regressedAt ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-warning">
                                <RotateCcw className="size-3" /> Regressed — was fixed, came back
                              </span>
                            ) : age ? (
                              <span className="text-[11px] text-muted-foreground">{age}</span>
                            ) : null}
                          </div>
                        )}
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
                        {isFixed
                          ? it.resolvedAt
                            ? timeAgo(it.resolvedAt)
                            : "-"
                          : it.count && it.count > 1
                            ? it.count
                            : "-"}
                      </td>
                      <td className="px-2 py-3">
                        {isFixed ? null : (
                          <span className="flex items-center justify-end gap-0.5">
                            <Link
                              href={findingAskHref(it)}
                              onClick={(e) => e.stopPropagation()}
                              title="Ask Atlas how to fix this"
                              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <AtlasAiMark size={14} className="size-3.5" />
                            </Link>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
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
    <Card className="h-full">
      <CardContent className="flex h-full flex-col justify-center p-4">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", severityMeta(sev).accent)} />
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
        </div>
        <p
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums",
            n > 0 && severityMeta(sev).text,
          )}
        >
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
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
