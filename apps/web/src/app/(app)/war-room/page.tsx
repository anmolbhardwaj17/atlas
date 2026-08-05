import { Suspense } from "react";
import Link from "next/link";
import { Crosshair, ChevronRight, ShieldCheck } from "lucide-react";
import { getPageAuth } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { sevHue } from "@/lib/severity";
import type { Incident } from "@/lib/browser-api";
import { ElapsedClock, StatusPulse } from "@/components/war-room/war-room-chrome";
import WarRoomLoading from "./loading";

export const dynamic = "force-dynamic";

/**
 * War Room board (docs/plans/war-room.md, board U1).
 *
 * Same theme, tokens and card patterns as every other page — an earlier pass gave this route a
 * bespoke dark surface, which read as a different product rather than a considered one. The
 * character comes from hierarchy and severity colour instead:
 *
 *  - **Live incidents are cards**: full width, severity-tinted, with a running clock. Before, a
 *    five-minute-old production outage and a month-old dismissal rendered as identical grey rows.
 *  - **Closed incidents stay a compact list** — the original row treatment, which was right for them.
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
        Investigate what&rsquo;s broken — a live, cited trace from the failing resource to the
        likely cause. Start one from a red node on the map or a finding in Insights.
      </p>

      {active.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Active</h2>
          <div className="space-y-3">
            {active.map((i) => (
              <LiveCard key={i.id} incident={i} />
            ))}
          </div>
        </section>
      ) : (
        <AllClear hasHistory={closed.length > 0} />
      )}

      {closed.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Closed</h2>
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {closed.map((i) => (
              <ClosedRow key={i.id} incident={i} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * A live incident: the app's standard card, tinted by severity. The colour is a hairline rail and a
 * faint wash — enough that an open high-severity incident is unmistakable at a glance, not so much
 * that the page stops looking like Atlas.
 */
function LiveCard({ incident: i }: { incident: Incident }) {
  return (
    <Link
      href={`/war-room/${i.id}`}
      style={{ "--sev": sevHue(i.severity) } as React.CSSProperties}
      className="group relative block overflow-hidden rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-[hsl(var(--sev)/0.4)] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: "hsl(var(--sev))" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "linear-gradient(100deg, hsl(var(--sev) / 0.055), transparent 45%)",
        }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <StatusPulse live hue="var(--sev)" />
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "hsl(var(--sev))" }}
            >
              {i.severity ?? "unknown"}
            </span>
            <span className="text-[11px] capitalize text-muted-foreground">· {i.status}</span>
          </div>
          <p className="text-balance text-[15px] font-medium leading-snug">{i.title}</p>
          <p className="text-xs text-muted-foreground">
            {i.nodeName ? <span className="text-foreground/70">{i.nodeName}</span> : null}
            {i.nodeName ? " · " : ""}
            opened {timeAgo(i.openedAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="flex flex-col items-end">
            <ElapsedClock since={i.openedAt} className="text-xl font-semibold" />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              elapsed
            </span>
          </div>
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

/** Closed incidents keep the original compact row — the right treatment for history. */
function ClosedRow({ incident: i }: { incident: Incident }) {
  return (
    <Link
      href={`/war-room/${i.id}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
    >
      <StatusPulse live={false} hue="var(--muted-foreground)" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{i.title}</p>
        <p className="text-xs text-muted-foreground">
          {i.status === "dismissed" ? "Dismissed" : "Resolved"}{" "}
          {timeAgo(i.resolvedAt ?? i.updatedAt)}
        </p>
      </div>
      <ElapsedClock
        since={i.openedAt}
        until={i.resolvedAt ?? i.updatedAt}
        className="shrink-0 text-xs text-muted-foreground"
      />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/** Nothing open. On an operations surface that's the good outcome, so it reads as reassurance. */
function AllClear({ hasHistory }: { hasHistory: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
      <ShieldCheck className="mx-auto size-6 text-success" />
      <p className="mt-3 text-sm font-medium">Nothing needs investigating</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        No open incidents. When a healthy production resource breaks, a War Room opens here
        automatically with the trace already running.
        {hasHistory ? " Past investigations are below." : ""}
      </p>
    </div>
  );
}
