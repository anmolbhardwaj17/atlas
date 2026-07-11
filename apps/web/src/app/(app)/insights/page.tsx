import { Suspense } from "react";
import Link from "next/link";
import { Radar } from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import {
  InsightsView,
  type Finding,
  type InsightsSummary,
  type Mute,
} from "@/components/insights/insights-view";
import type { Incident } from "@/lib/browser-api";
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
  const [res, incRes] = await Promise.all([
    apiGet<ApiOk<InsightsData>>("/insights", { token, orgId }),
    apiGet<ApiOk<{ incidents: Incident[] }>>("/incidents?limit=20", { token, orgId }),
  ]);
  const data = res.body?.data;
  const incidents = incRes.body?.data?.incidents ?? [];
  return (
    <div className="space-y-8">
      <InsightsView
        summary={data?.summary ?? null}
        findings={data?.findings ?? []}
        resolved={data?.resolved ?? []}
        mutes={data?.mutes ?? []}
        lastSyncedAt={data?.lastSyncedAt ?? null}
      />
      {incidents.length > 0 ? <PastIncidents incidents={incidents} /> : null}
    </div>
  );
}

const INCIDENT_CHIP: Record<string, string> = {
  open: "text-danger",
  analyzing: "text-warning",
  resolved: "text-success",
  dismissed: "text-muted-foreground",
};

/** War Room history — investigations persist so they're revisitable (docs/plans/war-room.md). */
function PastIncidents({ incidents }: { incidents: Incident[] }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Radar className="size-4 text-danger" /> War Room · past incidents
      </h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {incidents.map((i) => (
          <Link
            key={i.id}
            href={`/war-room/${i.id}`}
            className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{i.title}</p>
              <p className="text-xs text-muted-foreground">
                Opened {new Date(i.openedAt).toLocaleDateString()}
                {i.severity ? ` · ${i.severity}` : ""}
              </p>
            </div>
            <span
              className={`shrink-0 text-xs font-medium capitalize ${INCIDENT_CHIP[i.status] ?? ""}`}
            >
              {i.status}
            </span>
          </Link>
        ))}
      </div>
    </section>
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
