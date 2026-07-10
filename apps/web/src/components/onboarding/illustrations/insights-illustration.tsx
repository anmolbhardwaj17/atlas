"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * "Insights & posture" illustration — a realistic Insights card: severity-ranked finding rows with a
 * Well-Architected category chip, the top one highlighted with a guidance sparkle, plus a live
 * posture score ring. Reads as "prioritized, actionable findings — not a wall of alerts".
 */

const ROWS: Array<{ sev: string; cat: string; barW: string; hot?: boolean }> = [
  { sev: "bg-rose-500", cat: "Security", barW: "w-[70%]", hot: true },
  { sev: "bg-amber-500", cat: "Reliability", barW: "w-[52%]" },
  { sev: "bg-emerald-500", cat: "Cost", barW: "w-[40%]" },
];

function ScoreRing({ value }: { value: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <div className="relative grid size-8 place-items-center">
      <svg viewBox="0 0 24 24" className="size-8 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke="rgb(245 158 11)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <span className="absolute text-[8px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function InsightsIllustration() {
  return (
    <div className="absolute inset-0 p-3">
      <div className="flex size-full flex-col overflow-hidden rounded-xl border border-border bg-background/80 shadow-sm">
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="text-[10px] font-medium text-muted-foreground">
            Insights &amp; posture
          </span>
          <ScoreRing value={82} />
        </div>
        <div className="flex flex-col gap-1.5 px-2.5 pb-2.5">
          {ROWS.map((r, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5",
                r.hot ? "bg-amber-500/10" : "bg-muted/40",
              )}
            >
              <span className={cn("size-2 shrink-0 rounded-full", r.sev, r.hot && "illo-pulse")} />
              <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[8px] font-medium text-muted-foreground ring-1 ring-border">
                {r.cat}
              </span>
              <span className={cn("h-1.5 rounded-full bg-muted-foreground/25", r.barW)} />
              {r.hot ? <Sparkles className="ml-auto size-3 shrink-0 text-amber-500" /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
