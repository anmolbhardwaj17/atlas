"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Shared visual layer for the War Room (board U1).
 *
 * The design brief was that it "doesn't feel like a room". The fix isn't more chrome — it's that an
 * incident surface should be recognisably *not* the rest of the app. Everywhere else in Atlas is a
 * calm, light, dense reading surface. The War Room is the one place that goes dark and
 * high-contrast, so you know where you are the instant it loads, the way a NOC does.
 *
 * Three rules hold it together and keep it out of "glowing dark dashboard" territory:
 *
 *  1. **Severity is the only chroma, and it behaves like a light source.** Everything structural is
 *     neutral; the incident's own severity colour is the single hue in the room, and it *emits*
 *     (a soft bloom behind the headline) rather than being painted on as borders and pills. Scarce
 *     colour reads as signal. Colour everywhere reads as decoration.
 *  2. **Never pure black.** The surface is a tinted near-black; pure #000 kills depth and looks
 *     cheap next to real content.
 *  3. **No glass, no gradient text, no neon.** The atmosphere comes from contrast, restraint and
 *     one moving element (the clock) — not from effects.
 */

/** Severity → the room's accent. Maps to the existing --sev-* tokens; no new colours introduced. */
export const SEV_HUE: Record<string, string> = {
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
};

export function sevHue(severity: string | null | undefined): string {
  return SEV_HUE[severity ?? ""] ?? "var(--sev-medium)";
}

/**
 * The room itself: forces the dark token set regardless of the user's theme, and lays a very low
 * amplitude vertical rule texture over it. The texture is what stops a large dark area reading as
 * a flat void — it's near-invisible individually and reads as "instrumented surface" in aggregate.
 */
export function WarRoomSurface({
  hue,
  className,
  children,
}: {
  hue: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-theme="dark"
      style={{ "--room-hue": hue } as React.CSSProperties}
      className={cn(
        "dark relative isolate -mx-4 -mt-4 min-h-[calc(100dvh-4rem)] bg-[hsl(0_0%_6.5%)] px-4 pb-8 pt-4 text-foreground sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8",
        className,
      )}
    >
      {/* Instrument texture — 1px rules at low alpha. Pointer-events off; purely atmospheric. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.55]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, hsl(0 0% 100% / 0.022) 0 1px, transparent 1px 96px)",
        }}
      />
      {/* The severity bloom. Sits behind everything, top-left biased so the headline sits inside it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]"
        style={{
          background:
            "radial-gradient(60% 100% at 22% 0%, hsl(var(--room-hue) / 0.16), transparent 70%)",
        }}
      />
      {children}
    </div>
  );
}

/**
 * A live elapsed clock. Incident rooms have clocks — this is the one moving element in the design,
 * and it earns its place twice: it's the single most-asked question during an incident ("how long
 * has this been going?") and it makes a static page feel live.
 *
 * Ticks once a second under a minute, then every 30s — a seconds display that keeps re-rendering an
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
  // Under an hour show m:ss so short incidents read precisely; past that, h:mm — nobody triaging a
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
 * happening", so a screen of resolved incidents is completely still.
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
        style={{ background: live ? `hsl(${hue})` : "hsl(0 0% 42%)" }}
      />
    </span>
  );
}

/**
 * Section rule with a label — the room's structural device instead of yet another bordered card.
 * Cards-in-cards was the main thing making the old layout read as a generic dashboard.
 */
export function RoomRule({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {children}
      </h2>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );
}
