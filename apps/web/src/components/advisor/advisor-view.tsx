"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Gauge, DollarSign, ChevronRight, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AtlasAiMark } from "@/components/brand";
import { cn } from "@/lib/cn";
import { severityMeta } from "@/lib/taxonomy";
import { pillarMeta } from "@/components/insights/pillars";
import type { Finding } from "@/components/insights/insights-view";

/**
 * Advisor — Atlas's recommendations for a more reliable, secure, and efficient estate, GROUNDED in
 * the graph (docs/plans/optimization.md). Recommendations are the graph's live findings re-framed
 * as improvements and ranked by impact (severity × how much it affects). Each one is debatable:
 * "Ask Atlas about this" opens the cited advisory loop so you can argue the trade-off.
 *
 * Honesty (P4): everything here is architecture / reliability / security — things we can cite from
 * the graph. Cost + right-sizing NUMBERS need Cost Explorer + CloudWatch (Tier 2) and are teased,
 * never fabricated.
 */
const SEV_WEIGHT: Record<Finding["severity"], number> = { high: 100, medium: 30, low: 10 };

function affectedCount(f: Finding): number {
  return f.count ?? f.evidence?.length ?? 0;
}
/** Impact = severity × how much of the estate it touches, boosted if it recently regressed. */
function impactScore(f: Finding): number {
  const boost = f.regressedAt ? 1.5 : 1;
  return SEV_WEIGHT[f.severity] * (1 + affectedCount(f)) * boost;
}
/** A debate-framed question (trade-offs, "is it worth it for MY estate") — not just "how to fix". */
function debateHref(f: Finding): string {
  const q = `Should I address "${f.title}"? What breaks if I don't, what's the trade-off (cost/effort vs reliability/security), and is it worth doing for my estate?`;
  return `/ask?q=${encodeURIComponent(q)}`;
}

function relTime(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AdvisorView({
  findings,
  lastSyncedAt,
}: {
  findings: Finding[];
  lastSyncedAt: string | null;
}) {
  const ranked = React.useMemo(
    () => [...findings].sort((a, b) => impactScore(b) - impactScore(a)),
    [findings],
  );
  const synced = relTime(lastSyncedAt);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Advisor</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Atlas&apos;s recommendations for a more reliable, secure, and efficient estate — ranked by
          impact and grounded in your graph. Push back on any of them and Atlas will make its case.
        </p>
      </div>

      {/* Tier-2 honesty: cost/right-sizing $ numbers need data we don't ingest yet — never guessed. */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
        <DollarSign className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Want cost &amp; right-sizing numbers?</span>{" "}
          Connect AWS Cost Explorer + CloudWatch and Atlas will quantify the savings ($ / month, CPU
          / memory). Until then, every recommendation below is architecture, reliability &amp;
          security —{" "}
          <span className="font-medium text-foreground">cited from your graph, never guessed</span>.
        </p>
      </div>

      {ranked.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Gauge className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing high-impact right now</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your estate looks well set up on what Atlas can see. Connect Cost Explorer to surface
              cost optimizations too.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Do these first</h2>
            <span className="text-xs text-muted-foreground">
              {ranked.length} recommendation{ranked.length === 1 ? "" : "s"}
              {synced ? ` · from your sync ${synced}` : ""}
            </span>
          </div>

          {ranked.map((f, i) => {
            const sev = severityMeta(f.severity);
            const pillar = pillarMeta(f.guidance?.pillar);
            const affected = affectedCount(f);
            return (
              <Card key={f.id} className="overflow-hidden">
                <div className="flex">
                  <span className={cn("w-1 shrink-0 self-stretch", sev.accent)} aria-hidden />
                  <CardContent className="min-w-0 flex-1 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        #{i + 1}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          sev.className,
                        )}
                      >
                        <sev.icon className="size-3" />
                        {sev.label}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          pillar.badge,
                        )}
                      >
                        <pillar.icon className="size-3" />
                        {pillar.label}
                      </span>
                      {affected > 0 ? (
                        <span className="text-[11px] text-muted-foreground">
                          affects {affected} resource{affected === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {f.regressedAt ? (
                        <span className="text-[11px] font-medium text-warning">came back</span>
                      ) : null}
                    </div>

                    <h3 className="mt-2 text-base font-semibold tracking-tight">{f.title}</h3>

                    {f.guidance?.why || f.detail ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {f.guidance?.why ?? f.detail}
                      </p>
                    ) : null}

                    {f.guidance?.fix ? (
                      <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
                        <Wrench className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <p className="text-sm">
                          <span className="font-medium">Recommended:</span> {f.guidance.fix}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        href={debateHref(f)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
                      >
                        <AtlasAiMark size={14} className="size-3.5" />
                        Ask Atlas about this
                        <ArrowRight className="size-3.5" />
                      </Link>
                      <Link
                        href={`/insights/${f.id}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Details
                        <ChevronRight className="size-3.5" />
                      </Link>
                    </div>
                  </CardContent>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
