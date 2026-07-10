"use client";

import { CloudIcon } from "@/components/cloud-icon";
import { cn } from "@/lib/cn";

/**
 * "Security & vulnerabilities" illustration — a realistic vulnerabilities card: known CVEs in real
 * dependencies, each with a severity badge, the fixed version, and the count of repos it reaches
 * (GitHub logo), so it reads as "ranked by real blast radius", not just a raw list.
 */

interface Row {
  pkg: string;
  version: string;
  sev: "Crit" | "High" | "Med";
  badge: string;
  repos: number;
  hot?: boolean;
}

const ROWS: Row[] = [
  {
    pkg: "lodash",
    version: "4.17.20",
    sev: "Crit",
    badge: "bg-rose-500 text-white",
    repos: 6,
    hot: true,
  },
  { pkg: "axios", version: "0.21.1", sev: "High", badge: "bg-orange-500 text-white", repos: 3 },
  { pkg: "minimist", version: "1.2.5", sev: "Med", badge: "bg-amber-500 text-white", repos: 2 },
];

export function SecurityIllustration() {
  return (
    <div className="absolute inset-0 p-3">
      <div className="flex size-full flex-col overflow-hidden rounded-xl border border-border bg-background/80 shadow-sm">
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="text-[10px] font-medium text-muted-foreground">Vulnerabilities</span>
          <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-600 ring-1 ring-rose-500/25 dark:text-rose-400">
            11 found
          </span>
        </div>
        <div className="flex flex-col gap-1 px-2.5 pb-2.5 pt-1">
          {ROWS.map((r, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5",
                r.hot ? "bg-rose-500/10" : "bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "shrink-0 rounded px-1 py-0.5 text-[7px] font-bold uppercase tracking-wide",
                  r.badge,
                  r.hot && "illo-pulse",
                )}
              >
                {r.sev}
              </span>
              <span className="font-mono text-[9px] font-medium">{r.pkg}</span>
              <span className="text-[8px] text-muted-foreground">{r.version}</span>
              <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[8px] text-muted-foreground">
                <CloudIcon name="github-icon" className="size-2.5" /> {r.repos} repos
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
