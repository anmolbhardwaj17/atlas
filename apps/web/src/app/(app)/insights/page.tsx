import { Suspense } from "react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import {
  InsightsView,
  type Finding,
  type InsightsSummary,
  type Mute,
} from "@/components/insights/insights-view";
import InsightsLoading from "./loading";

export const dynamic = "force-dynamic";

interface InsightsData {
  summary: InsightsSummary;
  findings: Finding[];
  resolved: Finding[];
  mutes: Mute[];
  lastSyncedAt: string | null;
}

/** The data-bound part: the live `/insights` fetch + the view. Split out so it can stream behind a
 *  <Suspense> boundary while the shell paints immediately (perf P3). */
async function InsightsContent({ token, orgId }: { token: string; orgId: string }) {
  const res = await apiGet<ApiOk<InsightsData>>("/insights", { token, orgId });
  const data = res.body?.data;
  return (
    <InsightsView
      summary={data?.summary ?? null}
      findings={data?.findings ?? []}
      resolved={data?.resolved ?? []}
      mutes={data?.mutes ?? []}
      lastSyncedAt={data?.lastSyncedAt ?? null}
    />
  );
}

/**
 * Insights (Atlas Knowledge Engine) - the ADVISORY / action layer. Server-fetches the live
 * findings + posture summary and hands them to InsightsView for the scannable, filterable UI.
 * The heavy `/insights` fetch streams behind <Suspense> so the page commits on auth, not on data.
 */
export default async function InsightsPage() {
  const shell = await requireShell();
  return (
    <Suspense fallback={<InsightsLoading />}>
      <InsightsContent token={shell.token} orgId={shell.orgId} />
    </Suspense>
  );
}
