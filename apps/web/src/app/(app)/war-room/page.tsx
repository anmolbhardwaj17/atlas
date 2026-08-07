import { Suspense } from "react";
import Link from "next/link";
import { Crosshair, ChevronRight, ShieldCheck } from "lucide-react";
import { getPageAuth } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { severityMeta } from "@/lib/taxonomy";
import { sevHue } from "@/lib/severity";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type { Incident } from "@/lib/browser-api";
import { ElapsedClock, StatusPulse } from "@/components/war-room/war-room-chrome";
import WarRoomLoading from "./loading";

export const dynamic = "force-dynamic";

/**
 * War Room board (docs/plans/war-room.md, board U1).
 *
 * Same structure as Insights: a `Card` wrapping a `Table`, with a severity column that pairs a
 * coloured dot with a coloured label. Two earlier passes got this wrong in opposite directions — one
 * gave the route a bespoke dark surface, the other turned rows into stacked cards. Both broke the
 * app's list convention. Incidents are records in a list, so they get the list treatment the rest of
 * the app uses.
 *
 * What distinguishes active from closed is data, not a different component: the live table carries
 * severity colour, a pulsing dot and a running clock; the closed table is neutral and still.
 */
export default function WarRoomHome() {
  return (
    <Suspense fallback={<WarRoomLoading />}>
      <WarRoomContent />
    </Suspense>
  );
}

async function WarRoomContent() {
  const { token, orgId } = await getPageAuth();
  const incidents =
    (await apiGet<ApiOk<{ incidents: Incident[] }>>("/incidents?limit=100", { token, orgId })).body
      ?.data?.incidents ?? [];

  const active = incidents.filter((i) => i.status === "open" || i.status === "analyzing");
  const closed = incidents.filter((i) => i.status === "resolved" || i.status === "dismissed");

  return (
    <div className="motion-stagger space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Crosshair className="size-6 text-danger" /> War Room
        </h1>
        {active.length > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-danger">
            <StatusPulse live hue={sevHue(active[0]?.severity)} />
            {active.length} live {active.length === 1 ? "incident" : "incidents"}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" /> No open incidents
          </span>
        )}
      </div>
      <p className="-mt-4 max-w-2xl text-sm text-muted-foreground">
        Investigate what&rsquo;s broken - a live, cited trace from the failing resource to the
        likely cause. Start one from a red node on the map or a finding in Insights.
      </p>

      {active.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Active</h2>
          <IncidentTable incidents={active} live />
        </section>
      ) : (
        <AllClear hasHistory={closed.length > 0} />
      )}

      {closed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Closed</h2>
          <IncidentTable incidents={closed} live={false} />
        </section>
      ) : null}
    </div>
  );
}

/**
 * One table, two modes. `live` drives the differences that carry meaning — the dot pulses, severity
 * is coloured, and the elapsed column counts up rather than showing a final duration.
 */
function IncidentTable({ incidents, live }: { incidents: Incident[]; live: boolean }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">Severity</TableHead>
            <TableHead>Incident</TableHead>
            <TableHead className="hidden sm:table-cell">Resource</TableHead>
            <TableHead className="hidden md:table-cell">{live ? "Opened" : "Closed"}</TableHead>
            <TableHead className="text-right">{live ? "Elapsed" : "Duration"}</TableHead>
            <TableHead className="w-10 px-2" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((i) => {
            const m = severityMeta(i.severity ?? "low");
            return (
              <TableRow key={i.id} className="group">
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    {live ? (
                      <StatusPulse live hue={sevHue(i.severity)} />
                    ) : (
                      <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" />
                    )}
                    <span
                      className={cn(
                        "text-xs font-medium capitalize",
                        live ? m.text : "text-muted-foreground",
                      )}
                    >
                      {live ? (i.severity ?? "unknown") : i.status}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/war-room/${i.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {i.title}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {i.nodeName ?? "—"}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {timeAgo(live ? i.openedAt : (i.resolvedAt ?? i.updatedAt))}
                </TableCell>
                <TableCell className="text-right">
                  <ElapsedClock
                    since={i.openedAt}
                    until={live ? null : (i.resolvedAt ?? i.updatedAt)}
                    className={cn(
                      "text-sm",
                      live ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  />
                </TableCell>
                <TableCell className="px-2">
                  <Link
                    href={`/war-room/${i.id}`}
                    aria-label={`Open ${i.title}`}
                    className="inline-flex text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Nothing open. On an operations surface that's the good outcome, so it reads as reassurance. */
function AllClear({ hasHistory }: { hasHistory: boolean }) {
  return (
    <Card className="px-6 py-10 text-center">
      <ShieldCheck className="mx-auto size-6 text-success" />
      <p className="mt-3 text-sm font-medium">Nothing needs investigating</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        No open incidents. When a healthy production resource breaks, a War Room opens here
        automatically with the trace already running.
        {hasHistory ? " Past investigations are below." : ""}
      </p>
    </Card>
  );
}
