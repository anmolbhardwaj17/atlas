import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { AskWorkspace } from "@/components/ask/ask-workspace";
import type { ConversationSummary } from "@/lib/browser-api";

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

  if (hasCode) {
    if (s.findings.some((f) => /pipeline|ci\/cd|\bci\b/i.test(f.title))) {
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
  }
  return out.slice(0, 4);
}

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const shell = await requireShell();
  const { q } = await searchParams;
  const initial = Array.isArray(q) ? q[0] : q;

  const auth = { token: shell.token, orgId: shell.orgId };
  const [summaryRes, convosRes] = await Promise.all([
    apiGet<ApiOk<SummaryLite>>("/summary", auth),
    apiGet<ApiOk<ConversationSummary[]>>("/ai/conversations", auth),
  ]);

  return (
    <AskWorkspace
      orgId={shell.orgId}
      initialQuestion={initial}
      suggestions={suggestions(summaryRes.body?.data)}
      initialConversations={convosRes.body?.data ?? []}
    />
  );
}
