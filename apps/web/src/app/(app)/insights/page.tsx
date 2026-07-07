import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import {
  InsightsView,
  type Finding,
  type InsightsSummary,
} from "@/components/insights/insights-view";

export const dynamic = "force-dynamic";

interface InsightsData {
  summary: InsightsSummary;
  findings: Finding[];
}

/**
 * Insights (Atlas Knowledge Engine) - the ADVISORY / action layer. Server-fetches the live
 * findings + posture summary and hands them to InsightsView for the scannable, filterable UI.
 */
export default async function InsightsPage() {
  const shell = await requireShell();
  const res = await apiGet<ApiOk<InsightsData>>("/insights", {
    token: shell.token,
    orgId: shell.orgId,
  });
  const data = res.body?.data;
  return <InsightsView summary={data?.summary ?? null} findings={data?.findings ?? []} />;
}
