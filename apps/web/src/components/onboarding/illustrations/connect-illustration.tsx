"use client";

import { Lock } from "lucide-react";
import { CloudIcon } from "@/components/cloud-icon";
import { AtlasLogo } from "@/components/brand";

/**
 * "Connect" step illustration — real source logos (GitHub, AWS, Slack) wiring into a central Atlas
 * graph node, with pulses flowing toward it and a "Read-only" badge. Mirrors the map style; reads as
 * "connect your sources → Atlas builds one graph, read-only."
 */

const W = 300;
const H = 150;
const SOURCES = [
  { logo: "github-icon", x: 58, y: 40, delay: 0.2 },
  { logo: "aws", x: 48, y: 82, delay: 0.9 },
  { logo: "slack-icon", x: 66, y: 122, delay: 0.5 },
];
const HUB = { x: 216, y: 80 };
const pct = (v: number, t: number): string => `${(v / t) * 100}%`;

export function ConnectIllustration() {
  return (
    <div className="absolute inset-0">
      <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-border bg-background/90 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground shadow-sm">
        <Lock className="size-2.5" /> Read-only
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full"
      >
        {SOURCES.map((s, i) => (
          <g key={i}>
            <path
              id={`illo-conn-e${i}`}
              d={`M ${s.x} ${s.y} L ${HUB.x} ${HUB.y}`}
              fill="none"
              className="illo-edge"
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity={0.34}
              strokeWidth={1.25}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              r={2.2}
              className="illo-flow-dot fill-emerald-500 [filter:drop-shadow(0_0_3px_rgb(16_185_129/0.7))]"
            >
              <animateMotion dur="2.4s" begin={`${s.delay}s`} repeatCount="indefinite">
                <mpath href={`#illo-conn-e${i}`} />
              </animateMotion>
            </circle>
          </g>
        ))}
      </svg>

      {SOURCES.map((s, i) => (
        <div
          key={i}
          className="absolute"
          style={{ left: pct(s.x, W), top: pct(s.y, H), transform: "translate(-50%, -50%)" }}
        >
          <div
            className="illo-float grid size-8 place-items-center rounded-lg border border-border bg-background shadow-sm"
            style={{ animationDelay: `${s.delay}s` }}
          >
            <CloudIcon name={s.logo} className="size-5" />
          </div>
        </div>
      ))}

      {/* The hub = Atlas (your graph). */}
      <div
        className="absolute"
        style={{ left: pct(HUB.x, W), top: pct(HUB.y, H), transform: "translate(-50%, -50%)" }}
      >
        <div className="grid size-12 place-items-center rounded-xl border border-border bg-background shadow-sm">
          <AtlasLogo size={24} className="size-6 dark:invert" />
        </div>
      </div>
    </div>
  );
}
