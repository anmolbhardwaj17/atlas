import { Suspense } from "react";
import { getPageAuth } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { AskWorkspace } from "@/components/ask/ask-workspace";
import type { ConversationSummary } from "@/lib/browser-api";
import AskLoading from "./loading";

export const dynamic = "force-dynamic";

interface SummaryLite {
  inventory: {
    repositories: number;
    contributors: number;
    services: number;
    datastores: number;
    clouds: number;
  };
  crossBoundary: { crossCloud: number; crossAccount: number };
  findings: Array<{ title: string }>;
  insights: { mostActiveRepos: Array<{ name: string }> };
}

/** Suggested questions grounded in what's actually connected - so the empty state fits a code
 *  estate, an infra estate, or both, instead of showing irrelevant examples. */
function suggestions(s: SummaryLite | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  const inv = s.inventory;
  const hasCode = inv.repositories > 0;
  const hasInfra = inv.services + inv.datastores + inv.clouds > 0;
  const findingText = s.findings.map((f) => f.title).join(" · ");

  // Operational + security hooks first (only when there's actually something to look at), so the most
  // useful question surfaces when the estate needs attention.
  if (/unhealthy|degraded|broken|down|failing|error rate|incident/i.test(findingText)) {
    out.push("What's unhealthy right now, and what's the likely cause?");
  }
  if (/vulnerab|\bCVE\b|exposed|outdated/i.test(findingText)) {
    out.push("Which internet-exposed services are running a vulnerable dependency?");
  }

  if (hasCode) {
    if (/pipeline|ci\/cd|\bci\b/i.test(findingText)) {
      out.push("Which repositories have no CI/CD pipeline?");
    }
    if (inv.contributors > 0) out.push("Who are the top contributors this month?");
    const repo = s.insights?.mostActiveRepos?.[0]?.name;
    if (repo) out.push(`What's been happening in ${repo}?`);
  }
  if (hasInfra) {
    if (inv.datastores > 0) out.push("What depends on my databases?");
    if (s.crossBoundary.crossCloud + s.crossBoundary.crossAccount > 0) {
      out.push("What spans a cloud or account boundary?");
    }
    out.push("What would a failure of my most-connected service impact?");
    out.push("What changed across the estate this week?");
  }
  // De-dupe (a title could match two probes) and cap at 4.
  return [...new Set(out)].slice(0, 4);
}

export default function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<AskLoading />}>
      <AskContent searchParams={searchParams} />
    </Suspense>
  );
}

async function AskContent({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { token, orgId } = await getPageAuth();
  const { q } = await searchParams;
  const initial = Array.isArray(q) ? q[0] : q;

  const auth = { token, orgId };
  const [summaryRes, convosRes] = await Promise.all([
    apiGet<ApiOk<SummaryLite>>("/summary", auth),
    apiGet<ApiOk<ConversationSummary[]>>("/ai/conversations", auth),
  ]);

  return (
    <AskWorkspace
      orgId={orgId}
      initialQuestion={initial}
      suggestions={suggestions(summaryRes.body?.data)}
      initialConversations={convosRes.body?.data ?? []}
    />
  );
}
