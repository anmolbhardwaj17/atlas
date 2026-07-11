import Link from "next/link";
import { Crosshair, ChevronRight } from "lucide-react";
import { requireShell } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { EmptyState } from "@/components/patterns/empty-state";
import { timeAgo } from "@/components/war-room/war-room-context";
import type { Incident } from "@/lib/browser-api";

export const dynamic = "force-dynamic";

const CHIP: Record<string, string> = {
  open: "text-danger",
  analyzing: "text-warning",
  resolved: "text-success",
  dismissed: "text-muted-foreground",
};
const SEV: Record<string, string> = {
  high: "text-danger",
  medium: "text-warning",
  low: "text-yellow-600 dark:text-yellow-500",
};

function IncidentRow({ i }: { i: Incident }) {
  return (
    <Link
      href={`/war-room/${i.id}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{i.title}</p>
        <p className="text-xs text-muted-foreground">
          Opened {timeAgo(i.openedAt)}
          {i.severity ? (
            <>
              {" · "}
              <span className={SEV[i.severity] ?? ""}>{i.severity}</span>
            </>
          ) : null}
          {i.resolvedAt ? ` · closed ${timeAgo(i.resolvedAt)}` : ""}
        </p>
      </div>
      <span className={`shrink-0 text-xs font-medium capitalize ${CHIP[i.status] ?? ""}`}>
        {i.status}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * War Room home (docs/plans/war-room.md). Incidents are an OPERATIONAL surface — "what's broken now" —
 * distinct from Insights (posture). Active investigations up top, closed history below. Start one from
 * a red map node, an alert, or an Insights finding.
 */
export default async function WarRoomHome() {
  const { token, orgId } = await requireShell();
  const incidents =
    (await apiGet<ApiOk<{ incidents: Incident[] }>>("/incidents?limit=100", { token, orgId })).body
      ?.data?.incidents ?? [];

  const active = incidents.filter((i) => i.status === "open" || i.status === "analyzing");
  const closed = incidents.filter((i) => i.status === "resolved" || i.status === "dismissed");

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Crosshair className="size-6 text-danger" /> War Room
        </h1>
        <p className="text-sm text-muted-foreground">
          Investigate what&apos;s broken — a live, cited trace from the failing resource to the
          likely cause. Start one from a red node on the map or a finding in Insights.
        </p>
      </div>

      {incidents.length === 0 ? (
        <EmptyState
          icon={Crosshair}
          title="No incidents yet"
          description="When something looks wrong, open a War Room from a red resource on the map or an Insights finding — Atlas will trace the likely cause live."
        />
      ) : (
        <div className="space-y-6">
          {active.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Active</h2>
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {active.map((i) => (
                  <IncidentRow key={i.id} i={i} />
                ))}
              </div>
            </section>
          ) : null}
          {closed.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Closed</h2>
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {closed.map((i) => (
                  <IncidentRow key={i.id} i={i} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
