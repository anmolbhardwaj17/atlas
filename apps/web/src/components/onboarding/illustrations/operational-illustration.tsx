"use client";

import { AtlasAiMark } from "@/components/brand";
import { CloudIcon } from "@/components/cloud-icon";

/**
 * "Operational intelligence" illustration — a realistic service-health chart card: a metric that's
 * steady then spikes into an incident (rose marker + ping), with a floating AI callout that has
 * already found the root cause and cites the offending PR (GitHub logo + Atlas AI mark). UI-real:
 * a chart, a status pill, brand logos — the "broken right now, here’s why" moment.
 */

// Chart polyline in a 230×64 space: mostly flat, then a sharp spike at the end (the incident).
const PTS: Array<[number, number]> = [
  [6, 42],
  [30, 40],
  [54, 43],
  [78, 38],
  [102, 41],
  [126, 36],
  [150, 39],
  [174, 33],
  [196, 35],
  [210, 16],
  [224, 10],
];
const LINE = "M " + PTS.map(([x, y]) => `${x} ${y}`).join(" L ");
const AREA = `${LINE} L 224 60 L 6 60 Z`;

export function OperationalIllustration() {
  return (
    <div className="absolute inset-0 flex flex-col p-4">
      {/* Header. */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground">Service health</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-600 ring-1 ring-rose-500/25 dark:text-rose-400">
          <span className="size-1.5 rounded-full bg-rose-500" /> Degraded
        </span>
      </div>

      {/* Chart body. */}
      <div className="relative mt-2 flex-1">
        <svg
          aria-hidden
          viewBox="0 0 230 64"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
        >
          <defs>
            <linearGradient id="illo-ops-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(249 115 22)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="rgb(249 115 22)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={AREA} fill="url(#illo-ops-fill)" />
          <path
            d={LINE}
            fill="none"
            stroke="rgb(249 115 22)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Incident marker + ping, at the end of the spike (≈ 97% / 16% of the chart body). */}
        <div
          className="absolute"
          style={{ left: "97%", top: "16%", transform: "translate(-50%, -50%)" }}
        >
          <span className="relative grid place-items-center">
            <span className="illo-ripple absolute size-4 rounded-full bg-rose-500/40" />
            <span className="size-2 rounded-full bg-rose-500 ring-2 ring-background" />
          </span>
        </div>

        {/* AI root-cause callout - the "here’s why" moment. */}
        <div className="illo-float absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 shadow-md">
          <AtlasAiMark size={14} className="size-3.5 shrink-0" />
          <div className="leading-tight">
            <p className="text-[9px] font-semibold">Root cause found</p>
            <span className="mt-0.5 inline-flex items-center gap-1 text-[8px] text-muted-foreground">
              <CloudIcon name="github-icon" className="size-2.5" /> PR #4127
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
