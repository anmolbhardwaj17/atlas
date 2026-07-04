import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { SeverityBadge } from "@/components/tags";
import { AtlasAiMark } from "@/components/brand";

export const dynamic = "force-dynamic";

interface Finding {
  id: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  href: string | null;
  count?: number;
  guidance: { why: string; fix: string; pillar: string; source: string } | null;
}
interface InsightsData {
  stats: {
    repositories: number;
    services: number;
    datastores: number;
    pipelines: number;
    contributors: number;
    openPullRequests: number;
    pipelineCoverage: { withPipeline: number; total: number };
    crossBoundary: number;
  };
  lastSyncAt: string | null;
  findings: Finding[];
  highlights: {
    topContributors: Array<{ name: string; count: number }>;
    mostActiveRepos: Array<{ name: string; count: number }>;
  };
}

const PILLAR: Record<string, string> = {
  security: "Security",
  reliability: "Reliability",
  cost: "Cost",
  performance: "Performance",
  hygiene: "Hygiene",
  operations: "Operations",
};

/**
 * Insights (Atlas Knowledge Engine). Atlas's proactive surface: an estate-at-a-glance, the graph's
 * grounded findings paired with the advisory knowledge pack's guidance, and positive highlights.
 * All recomputed live from the latest sync, so new findings appear as the estate changes.
 */
export default async function InsightsPage() {
  const shell = await requireShell();
  const res = await apiGet<ApiOk<InsightsData>>("/insights", {
    token: shell.token,
    orgId: shell.orgId,
  });
  const data = res.body?.data;
  const stats = data?.stats;
  const findings = data?.findings ?? [];
  const highlights = data?.highlights;
  const coverage = stats?.pipelineCoverage;
  const coveragePct =
    coverage && coverage.total > 0 ? Math.round((coverage.withPipeline / coverage.total) * 100) : 0;

  return (
    <div className="w-full space-y-8">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Insights</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          What Atlas sees across your estate — recomputed live from your latest sync. Grounded
          findings with best-practice guidance, plus highlights. Ask Atlas to go deeper on anything.
        </p>
      </header>

      {/* Estate at a glance */}
      {stats ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Repositories" value={stats.repositories} />
          <StatTile label="Services" value={stats.services} />
          <StatTile label="Datastores" value={stats.datastores} />
          <StatTile label="Pipelines" value={stats.pipelines} />
          <StatTile label="Contributors" value={stats.contributors} />
          <StatTile label="Open PRs" value={stats.openPullRequests} />
          <StatTile
            label="CI/CD coverage"
            value={`${coveragePct}%`}
            sub={`${stats.pipelineCoverage.withPipeline} of ${stats.pipelineCoverage.total} repos`}
          />
          <StatTile label="Cross-boundary" value={stats.crossBoundary} />
        </section>
      ) : null}

      {/* Needs attention */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          Needs attention{findings.length ? ` · ${findings.length}` : ""}
        </h2>
        {findings.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <AtlasAiMark size={26} className="mx-auto mb-3 size-6" />
              <p className="text-sm text-muted-foreground">
                Nothing needs attention right now — the graph doesn&apos;t flag any issues.
              </p>
            </CardContent>
          </Card>
        ) : (
          findings.map((it) => (
            <Card key={it.id}>
              <CardContent className="space-y-3 p-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={it.severity} />
                    {it.guidance?.pillar ? (
                      <span className="text-xs text-muted-foreground">
                        {PILLAR[it.guidance.pillar] ?? it.guidance.pillar}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{it.title}</h3>
                </div>

                {it.guidance ? (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">Why it matters. </span>
                      {it.guidance.why}
                    </p>
                    <p>
                      <span className="font-medium text-foreground">How to fix. </span>
                      {it.guidance.fix}
                    </p>
                    <p className="text-xs text-muted-foreground/70">Guidance: {it.guidance.source}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{it.detail}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-1">
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
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      {/* Highlights */}
      {highlights &&
      (highlights.topContributors.length > 0 || highlights.mostActiveRepos.length > 0) ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Highlights</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Leaderboard
              title="Top contributors"
              sub="last 30 days · by PRs raised"
              rows={highlights.topContributors}
              unit="PRs"
            />
            <Leaderboard
              title="Most active repositories"
              sub="last 30 days · by PRs"
              rows={highlights.mostActiveRepos}
              unit="PRs"
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold tabular-nums text-foreground">{value}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
        {sub ? <div className="mt-0.5 text-[11px] text-muted-foreground/70">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function Leaderboard({
  title,
  sub,
  rows,
  unit,
}: {
  title: string;
  sub: string;
  rows: Array<{ name: string; count: number }>;
  unit: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          <p className="text-[11px] text-muted-foreground/70">{sub}</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No data yet.</p>
        ) : (
          <ol className="space-y-1.5">
            {rows.map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{r.name ?? "unknown"}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {r.count} {unit}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
