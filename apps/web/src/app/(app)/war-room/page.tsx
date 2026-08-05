import { Suspense } from "react";
import Link from "next/link";
import { ArrowUpRight, Radio } from "lucide-react";
import { getPageAuth } from "@/lib/shell";
import { apiGet, type ApiOk } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Incident } from "@/lib/browser-api";
import {
  WarRoomSurface,
  ElapsedClock,
  StatusPulse,
  RoomRule,
  sevHue,
} from "@/components/war-room/war-room-chrome";
import WarRoomLoading from "./loading";

export const dynamic = "force-dynamic";

/**
 * War Room board (docs/plans/war-room.md, board U1).
 *
 * Previously a flat list of rows under two headings — indistinguishable from every other list in the
 * app, which is exactly why it didn't read as a war room. The information hierarchy was flat too: a
 * five-minute-old production outage and a dismissed incident from last month rendered identically.
 *
 * Now the page is asymmetric on purpose. **Live incidents are the page** — full width, large type, a
 * running clock, the severity colour bleeding into the surface. **Closed incidents are an archive** —
 * small, still, monochrome, one line each. That asymmetry IS the design: what is happening now
 * should be physically bigger than what already happened.
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

  // The room takes its colour from the most severe thing currently burning. With nothing active it
  // stays neutral — a calm room when nothing is wrong is the correct signal, not a missed styling
  // opportunity.
  const worst =
    active.find((i) => i.severity === "high") ??
    active.find((i) => i.severity === "medium") ??
    active[0];
  const roomHue = active.length ? sevHue(worst?.severity) : "0 0% 50%";

  return (
    <WarRoomSurface hue={roomHue}>
      <div className="motion-stagger mx-auto max-w-6xl space-y-10">
        <Masthead activeCount={active.length} />

        {active.length > 0 ? (
          <section className="space-y-4">
            <RoomRule>
              {active.length} live {active.length === 1 ? "incident" : "incidents"}
            </RoomRule>
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
          <section className="space-y-4">
            <RoomRule>Archive</RoomRule>
            <div className="rounded-lg border border-border/60">
              {closed.map((i, n) => (
                <ArchiveRow key={i.id} incident={i} first={n === 0} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </WarRoomSurface>
  );
}

/** Status readout rather than a title block — an instrument, not a page header. */
function Masthead({ activeCount }: { activeCount: number }) {
  const live = activeCount > 0;
  return (
    <header className="space-y-3 pt-2">
      <div className="flex items-center gap-2.5">
        <StatusPulse live={live} hue="var(--room-hue)" />
        <span className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {live ? "Active investigation" : "All systems nominal"}
        </span>
      </div>
      <h1 className="text-[clamp(2rem,5vw,3rem)] font-semibold leading-[0.95] tracking-[-0.03em]">
        War Room
      </h1>
      <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
        A live, cited trace from the failing resource to the likely cause. Open one from a red node
        on the map or a finding in Insights.
      </p>
    </header>
  );
}

/**
 * A live incident. Deliberately large, and deliberately not a card in a grid: full width, its own
 * severity glow, and the elapsed clock as the biggest number present — during an incident "how long
 * has this been going?" is the question everyone asks first, so it gets the typographic weight.
 */
function LiveCard({ incident: i }: { incident: Incident }) {
  const hue = sevHue(i.severity);
  return (
    <Link
      href={`/war-room/${i.id}`}
      style={{ "--sev": hue } as React.CSSProperties}
      className="group relative block overflow-hidden rounded-xl border border-border/70 bg-[hsl(0_0%_9%)] p-5 transition-[border-color,transform] duration-300 ease-out hover:-translate-y-0.5 hover:border-[hsl(var(--sev)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sev)/0.6)] sm:p-6"
    >
      {/* Severity edge: a single hairline. A thick coloured border on one side is the lazy version
          of this and never looks intentional. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-px"
        style={{ background: "hsl(var(--sev))" }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: "radial-gradient(80% 120% at 0% 0%, hsl(var(--sev) / 0.08), transparent 60%)",
        }}
      />

      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <StatusPulse live hue="var(--sev)" />
            <span
              className="text-[0.7rem] font-medium uppercase tracking-[0.16em]"
              style={{ color: "hsl(var(--sev))" }}
            >
              {i.severity ?? "unknown"} · {i.status}
            </span>
          </div>
          <h3 className="text-balance text-lg font-medium leading-snug tracking-[-0.01em] sm:text-xl">
            {i.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {i.nodeName ? <span className="text-foreground/70">{i.nodeName}</span> : null}
            {i.nodeName ? " · " : ""}
            opened {timeAgo(i.openedAt)}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <ElapsedClock since={i.openedAt} className="text-2xl font-semibold sm:text-3xl" />
          <span className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
            elapsed
          </span>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
        Enter the room
        <ArrowUpRight className="size-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

/** Closed incidents: one quiet line each. No pulse, no colour, no elevation — this is history. */
function ArchiveRow({ incident: i, first }: { incident: Incident; first: boolean }) {
  return (
    <Link
      href={`/war-room/${i.id}`}
      className={`flex items-center gap-4 px-4 py-3 transition-colors hover:bg-white/[0.03] ${
        first ? "" : "border-t border-border/50"
      }`}
    >
      <StatusPulse live={false} hue="0 0% 42%" />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground/80">{i.title}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {i.status === "dismissed" ? "dismissed" : "resolved"} {timeAgo(i.resolvedAt ?? i.updatedAt)}
      </span>
      <ElapsedClock
        since={i.openedAt}
        until={i.resolvedAt ?? i.updatedAt}
        className="w-14 text-right text-xs text-muted-foreground"
      />
    </Link>
  );
}

/**
 * The quiet state. Not an error and not an absence of content — a deliberate "nothing is on fire",
 * which on an operations surface is the good outcome and should look like one.
 */
function AllClear({ hasHistory }: { hasHistory: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-border/60 bg-[hsl(0_0%_9%)] px-6 py-10">
      <Radio className="size-5 text-success" />
      <p className="text-lg font-medium tracking-[-0.01em]">Nothing is burning.</p>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        No open incidents. Atlas keeps watching — when a healthy production resource breaks, a room
        opens here automatically with the trace already running.
        {hasHistory ? " Past investigations are in the archive below." : ""}
      </p>
    </div>
  );
}
