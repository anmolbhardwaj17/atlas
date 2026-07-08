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

export const PILLAR_META: Record<string, { label: string; icon: LucideIcon }> = {
  security: { label: "Security", icon: ShieldCheck },
  reliability: { label: "Reliability", icon: Activity },
  cost: { label: "Cost", icon: DollarSign },
  performance: { label: "Performance", icon: Gauge },
  hygiene: { label: "Hygiene", icon: Sparkles },
  operations: { label: "Operations", icon: Cog },
};
export const pillarMeta = (p?: string) =>
  (p && PILLAR_META[p]) || { label: p ?? "General", icon: TriangleAlert };

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

/**
 * Insights (Atlas Knowledge Engine) - the ADVISORY layer. A scannable posture summary + a dense,
 * filterable findings table; each row opens a detail page with the full guidance, evidence, and
 * lifecycle actions. Findings are derived live from the graph, so a real fix auto-resolves them.
 */
export function InsightsView({
  summary,
  findings,
}: {
  summary: InsightsSummary | null;
  findings: Finding[];
}) {
  const router = useRouter();
  const sorted = React.useMemo(
    () => [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3)),
    [findings],
  );

  const pillars = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of sorted) {
      const p = f.guidance?.pillar ?? "general";
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [sorted]);

  const [pillar, setPillar] = React.useState<string>("all");
  const shown =
    pillar === "all" ? sorted : sorted.filter((f) => (f.guidance?.pillar ?? "general") === pillar);

  const cov = summary?.pipelineCoverage;
  const covPct = cov && cov.total > 0 ? Math.round((cov.withPipeline / cov.total) * 100) : null;
  const covGap = cov ? cov.total - cov.withPipeline : 0;

  return (
    <div className="w-full space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Insights</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          What to act on - grounded findings with best-practice guidance. Open any one for the full
          fix, evidence, and to track it. Recomputed live from your latest sync.
        </p>
      </header>

      {/* Posture summary: severity tiles + CI/CD coverage. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SeverityTile
          label="High priority"
          n={summary?.high ?? 0}
          sev="high"
          hint="Fix these first"
        />
        <SeverityTile
          label="Medium"
          n={summary?.medium ?? 0}
          sev="medium"
          hint="Worth addressing"
        />
        <SeverityTile label="Low" n={summary?.low ?? 0} sev="low" hint="Nice to clean up" />
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

      {/* Pillar filter. */}
      {pillars.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <Chip active={pillar === "all"} onClick={() => setPillar("all")}>
            All <span className="text-muted-foreground">{sorted.length}</span>
          </Chip>
          {pillars.map(([p, n]) => {
            const m = pillarMeta(p);
            return (
              <Chip key={p} active={pillar === p} onClick={() => setPillar(p)}>
                <m.icon className="size-3.5" /> {m.label}{" "}
                <span className="text-muted-foreground">{n}</span>
              </Chip>
            );
          })}
        </div>
      ) : null}

      {/* Findings table - dense + scannable; a row opens its detail page. */}
      {shown.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <AtlasAiMark size={28} className="mx-auto mb-3 size-7" />
            <p className="text-sm text-muted-foreground">
              {sorted.length === 0
                ? "Nothing needs attention right now - the graph doesn't flag any issues. You're in good shape."
                : "No findings in this category."}
            </p>
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
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
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
