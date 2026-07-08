import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { SeverityBadge } from "@/components/tags";
import { AtlasAiMark } from "@/components/brand";
import { ErrorState } from "@/components/patterns/empty-state";
import {
  pillarMeta,
  type Finding,
  type InsightsSummary,
} from "@/components/insights/insights-view";

export const dynamic = "force-dynamic";

interface InsightsData {
  summary: InsightsSummary;
  findings: Finding[];
}

/**
 * Finding detail (the row → detail drill-in). Findings are derived live, so we resolve the id
 * against the current list; if it's gone, it resolved on its own since you last looked. Home for
 * the full guidance, evidence, Ask Atlas, and (next) the lifecycle actions.
 */
export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shell = await requireShell();
  const res = await apiGet<ApiOk<InsightsData>>("/insights", {
    token: shell.token,
    orgId: shell.orgId,
  });
  const finding = res.body?.data?.findings.find((f) => f.id === id) ?? null;
  const m = pillarMeta(finding?.guidance?.pillar);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <Link
        href="/insights"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Insights
      </Link>

      {!finding ? (
        <ErrorState
          title="This finding cleared"
          description="It's no longer flagged in your latest graph - either it was fixed and auto-resolved, or the resource went away. Nice."
          actions={
            <Link
              href="/insights"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted/50"
            >
              Back to Insights
            </Link>
          }
        />
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={finding.severity} />
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <m.icon className="size-3.5" /> {m.label}
              </span>
              {finding.count && finding.count > 1 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {finding.count} affected
                </span>
              ) : null}
            </div>
            <h1 className="text-xl font-semibold leading-snug">{finding.title}</h1>
          </div>

          {finding.guidance ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardContent className="space-y-1.5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Why it matters
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {finding.guidance.why}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-1.5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    How to fix
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {finding.guidance.fix}
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                {finding.detail}
              </CardContent>
            </Card>
          )}

          {finding.detail ? (
            <Card>
              <CardContent className="space-y-1.5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  What Atlas found
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/ask?q=${encodeURIComponent(`How do I fix: ${finding.title}?`)}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <AtlasAiMark size={15} className="size-4" /> Ask Atlas how to fix this
            </Link>
            {finding.href ? (
              <Link
                href={finding.href}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                View evidence <ArrowRight className="size-3.5" />
              </Link>
            ) : null}
            {finding.guidance?.source ? (
              <span className="ml-auto text-xs text-muted-foreground/70">
                Guidance: {finding.guidance.source}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
