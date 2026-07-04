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
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  detail: string;
  href: string | null;
  count?: number;
  guidance: { why: string; fix: string; pillar: string; source: string } | null;
}
interface InsightsData {
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
    pipelineCoverage: { withPipeline: number; total: number };
  };
  findings: Finding[];
}

const PILLAR: Record<string, string> = {
  security: "Security",
  reliability: "Reliability",
  cost: "Cost",
  performance: "Performance",
  hygiene: "Hygiene",
  operations: "Operations",
};
const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const SEV_DOT: Record<string, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-inferred-low",
};

/**
 * Insights (Atlas Knowledge Engine) — the ADVISORY / action layer. Distinct from the dashboard
 * (status glance): this is where you come to *improve*. Every grounded finding is paired with the
 * knowledge pack's guidance (why it matters / how to fix / source) and opens an Ask Atlas advisory
 * thread. Action‑framed, prioritised by severity.
 */
export default async function InsightsPage() {
  const shell = await requireShell();
  const res = await apiGet<ApiOk<InsightsData>>("/insights", {
    token: shell.token,
    orgId: shell.orgId,
  });
  const summary = res.body?.data?.summary;
  const findings = [...(res.body?.data?.findings ?? [])].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3),
  );
  const cov = summary?.pipelineCoverage;
  const covPct = cov && cov.total > 0 ? Math.round((cov.withPipeline / cov.total) * 100) : null;
  const covGap = cov ? cov.total - cov.withPipeline : 0;

  return (
    <div className="w-full space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Insights</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          What to act on — grounded findings with best‑practice guidance on how to fix and optimise.
          Recomputed live from your latest sync. Ask Atlas to go deeper on any of them.
        </p>
      </header>

      {/* Action-framed summary strip (not a status dump — the dashboard covers status). */}
      {summary && (summary.total > 0 || covGap > 0) ? (
        <div className="flex flex-wrap items-center gap-2">
          {summary.total > 0 ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm">
              <span className="font-medium text-foreground">{summary.total} to act on</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {summary.high > 0 ? <SevCount dot="bg-danger" n={summary.high} label="high" /> : null}
                {summary.medium > 0 ? (
                  <SevCount dot="bg-warning" n={summary.medium} label="medium" />
                ) : null}
                {summary.low > 0 ? (
                  <SevCount dot="bg-inferred-low" n={summary.low} label="low" />
                ) : null}
              </span>
            </span>
          ) : null}
          {covPct !== null && covGap > 0 ? (
            <Link
              href={`/ask?q=${encodeURIComponent("How do I improve my CI/CD pipeline coverage?")}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              CI/CD coverage{" "}
              <span className="font-medium text-foreground">{covPct}%</span> · {covGap} repos to
              cover <ArrowRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* The findings — the core of the advisory layer. */}
      {findings.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <AtlasAiMark size={28} className="mx-auto mb-3 size-7" />
            <p className="text-sm text-muted-foreground">
              Nothing needs attention right now — the graph doesn&apos;t flag any issues. You&apos;re
              in good shape.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {findings.map((it) => (
            <Card key={it.id}>
              <CardContent className="space-y-3 p-5">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`size-2 rounded-full ${SEV_DOT[it.severity] ?? "bg-muted"}`} />
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
          ))}
        </div>
      )}
    </div>
  );
}

function SevCount({ dot, n, label }: { dot: string; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`size-1.5 rounded-full ${dot}`} />
      {n} {label}
    </span>
  );
}
