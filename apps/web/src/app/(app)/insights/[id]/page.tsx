import Link from "next/link";
import { ArrowRight, Boxes, Clock, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { SeverityBadge } from "@/components/tags";
import { AtlasAiMark } from "@/components/brand";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";
import { ErrorState } from "@/components/patterns/empty-state";
import { FindingActions } from "@/components/insights/finding-actions";
import { pillarMeta } from "@/components/insights/pillars";
import { type Finding, type InsightsSummary, type Mute } from "@/components/insights/insights-view";

export const dynamic = "force-dynamic";

interface InsightsData {
  summary: InsightsSummary;
  findings: Finding[];
  mutes: Mute[];
}

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago"). Server-safe (pure). */
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
 * Finding detail (the row → detail drill-in). Findings are derived live, so we resolve the id
 * against the current list; if it's gone, it resolved on its own since you last looked. Home for
 * the full guidance, the affected-resource evidence, lifecycle actions, and Ask Atlas.
 */
export default async function FindingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const shell = await requireShell();
  const res = await apiGet<ApiOk<InsightsData>>("/insights", {
    token: shell.token,
    orgId: shell.orgId,
  });
  const finding = res.body?.data?.findings.find((f) => f.id === id) ?? null;
  const mute = res.body?.data?.mutes.find((mm) => mm.findingId === id) ?? null;
  const m = pillarMeta(finding?.guidance?.pillar);

  // Lifecycle metadata (persisted, reconciled each sync) + affected-resource evidence parsed from
  // the finding's detail (a "; "-joined list when the finding names specific resources).
  const firstSeen = finding?.firstSeenAt ?? null;
  const ageDays = firstSeen
    ? Math.floor((Date.now() - new Date(firstSeen).getTime()) / 86_400_000)
    : null;
  // Prefer the structured node evidence (deep-linkable) when the API provides it; otherwise parse
  // the detail string into a list (a "; "-joined resource list), else fall back to a paragraph.
  const nodeEvidence = finding?.evidence ?? [];
  const hasNodeEvidence = nodeEvidence.length > 0;
  const evidence =
    finding?.detail
      ?.split(";")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const evidenceIsList = evidence.length > 1;
  const affectedCount = hasNodeEvidence ? nodeEvidence.length : evidence.length;

  return (
    <div className="w-full space-y-6">
      <SetBreadcrumbs
        items={[{ label: "Insights", href: "/insights" }, { label: finding?.title ?? "Finding" }]}
      />

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
          {/* Header: title + badges + lifecycle on the left; lifecycle actions on the right,
              wrapping under a long title rather than squeezing it. */}
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="min-w-0 flex-1 space-y-2.5">
              <h1 className="text-2xl font-semibold leading-snug tracking-tight">
                {finding.title}
              </h1>
              {/* Badges below the title. */}
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={finding.severity} />
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.badge}`}
                >
                  <m.icon className="size-3.5" /> {m.label}
                </span>
                {finding.count && finding.count > 1 ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {finding.count} affected
                  </span>
                ) : null}
                {mute ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Muted
                  </span>
                ) : null}
                {finding.regressedAt ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                    <RotateCcw className="size-3" /> Regressed
                  </span>
                ) : null}
              </div>
              {/* Lifecycle + provenance strip. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {firstSeen ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="size-3.5" /> Detected {timeAgo(firstSeen)}
                  </span>
                ) : null}
                {ageDays !== null && ageDays >= 1 ? <span>Open {ageDays}d</span> : null}
                {finding.guidance?.source ? <span>Guidance: {finding.guidance.source}</span> : null}
              </div>
            </div>
            <div className="shrink-0">
              <FindingActions orgId={shell.orgId} findingId={finding.id} muted={mute !== null} />
            </div>
          </div>

          {/* Why it matters / How to fix. */}
          {finding.guidance ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardContent className="space-y-2 p-5">
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <ShieldAlert className="size-3.5" /> Why it matters
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {finding.guidance.why}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-2 p-5">
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Wrench className="size-3.5" /> How to fix
                  </p>
                  <p className="text-sm leading-relaxed text-foreground/90">
                    {finding.guidance.fix}
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {/* Evidence — the affected resources, shown inline (not just a link out). */}
          {finding.detail ? (
            <Card>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Boxes className="size-3.5" /> Evidence
                    {affectedCount > 1 ? (
                      <span className="font-normal normal-case text-muted-foreground/70">
                        · {affectedCount} affected
                      </span>
                    ) : null}
                  </p>
                  {finding.href ? (
                    <Link
                      href={finding.href}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Open in Explore <ArrowRight className="size-3.5" />
                    </Link>
                  ) : null}
                </div>
                {hasNodeEvidence ? (
                  <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                    {nodeEvidence.map((n) => (
                      <li key={n.id}>
                        <Link
                          href={`/explore/${n.id}`}
                          className="flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40"
                        >
                          <Boxes className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground/90">
                            {n.label}
                          </span>
                          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : evidenceIsList ? (
                  <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
                    {evidence.map((item, i) => (
                      <li key={i} className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
                        <Boxes className="size-4 shrink-0 text-muted-foreground" />
                        <span className="font-mono text-[13px] text-foreground/90">{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">{finding.detail}</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Primary CTA. */}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/ask?q=${encodeURIComponent(`How do I fix: ${finding.title}?`)}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              <AtlasAiMark size={15} className="size-4" /> Ask Atlas how to fix this
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
