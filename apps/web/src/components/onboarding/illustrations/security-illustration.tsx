"use client";

import { Package, GitBranch, ShieldAlert } from "lucide-react";

/**
 * "Security & vulnerabilities" illustration — one vulnerable package at the centre with a blast-radius
 * ping rippling out to the repositories that depend on it, plus a CVE badge. Reads as "a single CVE,
 * ranked by how many repos it actually reaches".
 */

const W = 300;
const H = 150;
const PKG = { x: 150, y: 78 };
const REPOS = [
  { x: 64, y: 40 },
  { x: 64, y: 116 },
  { x: 236, y: 40 },
  { x: 236, y: 116 },
];

const pct = (x: number, total: number): string => `${(x / total) * 100}%`;

export function SecurityIllustration() {
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 52%, rgb(244 63 94 / 0.10), transparent 62%)",
        }}
      />
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full"
      >
        {/* Dependency edges package → repos. */}
        {REPOS.map((r, i) => (
          <line
            key={i}
            x1={PKG.x}
            y1={PKG.y}
            x2={r.x}
            y2={r.y}
            className="illo-edge"
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity={0.3}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Blast-radius ripple from the package. */}
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx={PKG.x}
            cy={PKG.y}
            r={30}
            fill="none"
            stroke="rgb(244 63 94)"
            strokeOpacity={0.5}
            strokeWidth={1.5}
            className="illo-ripple"
            style={{ animationDelay: `${i}s` }}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* Repo chips. */}
      {REPOS.map((r, i) => (
        <div
          key={i}
          className="absolute"
          style={{ left: pct(r.x, W), top: pct(r.y, H), transform: "translate(-50%, -50%)" }}
        >
          <div
            className="illo-float grid size-8 place-items-center rounded-lg border border-border bg-background shadow-sm"
            style={{ animationDelay: `${i * 0.45}s` }}
          >
            <GitBranch className="size-4 text-rose-500" />
          </div>
        </div>
      ))}

      {/* The vulnerable package (centre). */}
      <div
        className="absolute"
        style={{ left: pct(PKG.x, W), top: pct(PKG.y, H), transform: "translate(-50%, -50%)" }}
      >
        <div className="grid size-10 place-items-center rounded-xl border border-rose-500/40 bg-background shadow-sm">
          <Package className="size-5 text-rose-500" />
        </div>
      </div>

      {/* CVE badge above the package. */}
      <div
        className="absolute"
        style={{ left: pct(PKG.x, W), top: pct(PKG.y - 36, H), transform: "translate(-50%, -50%)" }}
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-600 ring-1 ring-rose-500/30 dark:text-rose-400">
          <ShieldAlert className="size-2.5" /> CVE
        </span>
      </div>
    </div>
  );
}
