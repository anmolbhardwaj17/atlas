import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { SeverityBadge } from "@/components/tags";
import { AtlasAiMark } from "@/components/brand";

export const dynamic = "force-dynamic";

interface Insight {
  id: string;
  severity: string;
  category: string;
  title: string;
  detail: string;
  href: string | null;
  count?: number;
  guidance: { why: string; fix: string; pillar: string; source: string } | null;
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
 * Insights (Atlas Knowledge Engine). Proactive counterpart to Ask Atlas: what the graph noticed,
 * as grounded findings paired with the advisory knowledge pack's best-practice guidance. Every card
 * is a fact Atlas proves + how to act on it, and links into an Ask Atlas advisory thread.
 */
export default async function InsightsPage() {
  const shell = await requireShell();
  const res = await apiGet<ApiOk<Insight[]>>("/insights", {
    token: shell.token,
    orgId: shell.orgId,
  });
  const insights = res.body?.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Insights</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          What Atlas noticed in your estate — grounded findings with best-practice guidance. Ask
          Atlas to go deeper on any of them.
        </p>
      </header>

      {insights.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <AtlasAiMark size={28} className="mx-auto mb-3 size-7" />
            <p className="text-sm text-muted-foreground">
              Nothing needs attention right now — the graph doesn&apos;t flag any issues. You&apos;re
              in good shape.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {insights.map((it) => (
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
                  <h2 className="text-sm font-semibold text-foreground">{it.title}</h2>
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
                    <p className="text-xs text-muted-foreground/70">
                      Guidance: {it.guidance.source}
                    </p>
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
