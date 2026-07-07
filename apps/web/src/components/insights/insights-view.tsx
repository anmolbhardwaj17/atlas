"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Cog,
  DollarSign,
  Gauge,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SeverityBadge } from "@/components/tags";
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

const PILLAR_META: Record<string, { label: string; icon: LucideIcon }> = {
  security: { label: "Security", icon: ShieldCheck },
  reliability: { label: "Reliability", icon: Activity },
  cost: { label: "Cost", icon: DollarSign },
  performance: { label: "Performance", icon: Gauge },
  hygiene: { label: "Hygiene", icon: Sparkles },
  operations: { label: "Operations", icon: Cog },
};
const pillarMeta = (p?: string) =>
  (p && PILLAR_META[p]) || { label: p ?? "General", icon: TriangleAlert };

const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const SEV_ACCENT: Record<string, string> = {
  high: "border-l-danger",
  medium: "border-l-warning",
  low: "border-l-inferred-low",
};
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
 * Insights (Atlas Knowledge Engine) - the ADVISORY layer. A scannable posture summary up top,
 * then prioritised findings, each with why-it-matters / how-to-fix and a one-click Ask Atlas
 * thread. Filter by pillar to focus. Distinct from the dashboard's status glance: you come here
 * to *improve*.
 */
export function InsightsView({
  summary,
  findings,
}: {
  summary: InsightsSummary | null;
  findings: Finding[];
}) {
  const sorted = React.useMemo(
    () => [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3)),
    [findings],
  );

  // Pillars present, with counts, for the filter chips.
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
          What to act on - grounded findings with best-practice guidance on how to fix and optimise.
          Recomputed live from your latest sync.
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
                {covGap > 0 ? (
                  <Link
                    href={`/ask?q=${encodeURIComponent("How do I improve my CI/CD pipeline coverage?")}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {covGap} repo{covGap === 1 ? "" : "s"} to cover{" "}
                    <ArrowRight className="size-3" />
                  </Link>
                ) : (
                  <p className="mt-2 text-xs text-success">Every repo has a pipeline.</p>
                )}
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

      {/* Findings. */}
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
        <div className="space-y-3">
          {shown.map((it) => {
            const m = pillarMeta(it.guidance?.pillar);
            return (
              <Card key={it.id} className={cn("border-l-4", SEV_ACCENT[it.severity])}>
                <CardContent className="flex gap-4 p-5">
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <m.icon className="size-[18px]" />
                  </span>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={it.severity} />
                        <span className="text-xs text-muted-foreground">{m.label}</span>
                        {it.count && it.count > 1 ? (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {it.count}×
                          </span>
                        ) : null}
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">{it.title}</h3>
                    </div>

                    {it.guidance ? (
                      <div className="grid gap-3 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground sm:grid-cols-2">
                        <p>
                          <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-foreground/70">
                            Why it matters
                          </span>
                          {it.guidance.why}
                        </p>
                        <p>
                          <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-foreground/70">
                            How to fix
                          </span>
                          {it.guidance.fix}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">{it.detail}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-0.5">
                      <Link
                        href={`/ask?q=${encodeURIComponent(`How do I fix: ${it.title}?`)}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                      >
                        <AtlasAiMark size={14} className="size-3.5" /> Ask Atlas
                      </Link>
                      {it.href ? (
                        <Link
                          href={it.href}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          View evidence <ArrowRight className="size-3" />
                        </Link>
                      ) : null}
                      {it.guidance?.source ? (
                        <span className="ml-auto text-[11px] text-muted-foreground/70">
                          {it.guidance.source}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
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
