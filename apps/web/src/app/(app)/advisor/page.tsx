import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { AdvisorView } from "@/components/advisor/advisor-view";
import type { Finding } from "@/components/insights/insights-view";

export const dynamic = "force-dynamic";

interface AdvisorData {
  findings: Finding[];
  lastSyncedAt: string | null;
}

/**
 * Advisor (docs/plans/optimization.md) — grounded, ranked recommendations for a better estate,
 * each debatable via Ask Atlas. Reuses the /insights payload (findings + guidance), so it stays in
 * lockstep with the graph's live findings; the ranking + debate framing are the Advisor's own.
 */
export default async function AdvisorPage() {
  const shell = await requireShell();
  const res = await apiGet<ApiOk<AdvisorData>>("/insights", {
    token: shell.token,
    orgId: shell.orgId,
  });
  const data = res.body?.data;
  return <AdvisorView findings={data?.findings ?? []} lastSyncedAt={data?.lastSyncedAt ?? null} />;
}
