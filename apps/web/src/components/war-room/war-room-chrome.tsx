"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Small shared pieces for the War Room (board U1).
 *
 * An earlier pass gave this route its own forced-dark surface with a bloom and a rule texture. That
 * was a mistake: a bespoke surface on one route is an inconsistency, not a design — it read as a
 * different product. The War Room now uses the app's own theme, tokens and card patterns like every
 * other page, and gets its character from information hierarchy and severity colour instead:
 * live incidents are large and coloured, settled ones are small and neutral.
 *
 * What survives from that pass is only what carries information — the clock and the pulse.
 */

/**
 * A live elapsed clock. "How long has this been going?" is the first question asked in any incident,
 * so it's worth a component rather than a static timestamp — and it keeps the page feeling live.
 *
 * Ticks once a second under a minute, then every 30s; a seconds readout that keeps re-rendering an
 * hour into an incident is noise, not information.
 */
export function ElapsedClock({
  since,
  until,
  className,
}: {
  since: string;
  until?: string | null;
  className?: string;
}) {
  const frozen = Boolean(until);
  const [, force] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => {
    if (frozen) return;
    const started = new Date(since).getTime();
    const young = Date.now() - started < 60_000;
    const id = setInterval(force, young ? 1_000 : 30_000);
    return () => clearInterval(id);
  }, [frozen, since]);

  const end = until ? new Date(until).getTime() : Date.now();
  const secs = Math.max(0, Math.floor((end - new Date(since).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  // Under an hour show m:ss so short incidents read precisely; past that h:mm — nobody triaging a
  // four-hour outage needs the seconds.
  const text = h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;

  return (
    <span
      className={cn("tabular-nums tracking-tight", className)}
      title={frozen ? "Total duration" : "Elapsed since opened"}
    >
      {text}
      <span className="ml-0.5 text-[0.7em] opacity-60">{h > 0 ? "h" : "m"}</span>
    </span>
  );
}

/**
 * Status dot. Live incidents pulse; settled ones don't — motion is reserved for "this is still
 * happening", so a list of resolved incidents is completely still.
 */
export function StatusPulse({ live, hue }: { live: boolean; hue: string }) {
  return (
    <span className="relative grid size-2.5 shrink-0 place-items-center">
      {live ? (
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none"
          style={{ background: `hsl(${hue})` }}
        />
      ) : null}
      <span
        className="relative size-2 rounded-full"
        style={{ background: live ? `hsl(${hue})` : "hsl(var(--muted-foreground) / 0.5)" }}
      />
    </span>
  );
}
