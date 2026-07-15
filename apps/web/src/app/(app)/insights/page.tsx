import { Suspense } from "react";
import { getPageAuth } from "@/lib/shell";
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
async function InsightsContent() {
  const { token, orgId } = await getPageAuth();
  const res = await apiGet<ApiOk<InsightsData>>("/insights", { token, orgId });
  // A failed fetch must NOT render as "All clear" — that fabricates a healthy estate (P4/P7). Throw
  // to the in-shell error boundary; a genuinely empty result still has a body and renders normally.
  if (res.body === null) throw new Error(`Failed to load insights (status ${res.status})`);
  const data = res.body.data;
  return (
    <InsightsView
      orgId={orgId}
      summary={data.summary ?? null}
      findings={data.findings ?? []}
      resolved={data.resolved ?? []}
      mutes={data.mutes ?? []}
      lastSyncedAt={data.lastSyncedAt ?? null}
    />
  );
}

/**
 * Insights (Atlas Knowledge Engine) - the ADVISORY / action layer. Server-fetches the live
 * findings + posture summary and hands them to InsightsView for the scannable, filterable UI.
 * The heavy `/insights` fetch streams behind <Suspense> so the page commits on auth, not on data.
 */
export default function InsightsPage() {
  return (
    <Suspense fallback={<InsightsLoading />}>
      <InsightsContent />
    </Suspense>
  );
}
