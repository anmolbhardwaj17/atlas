"use client";

import { CloudIcon } from "@/components/cloud-icon";

/**
 * "Live infrastructure map" illustration — a realistic mini map: real cloud-service + code logos on
 * card chips (GitHub → API Gateway → ECS/Lambda → RDS/S3), wired by edges with pulses travelling
 * along them, over a dotted canvas with a "Live" freshness pill. Mirrors the real map's look with
 * actual brand logos, per the reference direction.
 */

const W = 300;
const H = 150;

interface MapNode {
  id: string;
  x: number;
  y: number;
  logo: string;
  delay: number;
}

const NODES: MapNode[] = [
  { id: "repo", x: 34, y: 28, logo: "github-icon", delay: 0.2 },
  { id: "api", x: 34, y: 96, logo: "aws-api-gateway", delay: 0.9 },
  { id: "ecs", x: 122, y: 50, logo: "aws-ecs", delay: 1.3 },
  { id: "lambda", x: 122, y: 112, logo: "aws-lambda", delay: 0.5 },
  { id: "rds", x: 244, y: 50, logo: "aws-rds", delay: 1.0 },
  { id: "s3", x: 244, y: 112, logo: "aws-s3", delay: 0.35 },
];
const node = (id: string): MapNode => NODES.find((n) => n.id === id) ?? NODES[0]!;

/** [from, to, pulse-delay(s), flowing?] */
const EDGES: Array<[string, string, number]> = [
  ["repo", "ecs", 0.2],
  ["api", "ecs", 0.6],
  ["api", "lambda", 1.0],
  ["ecs", "rds", 1.4],
  ["lambda", "s3", 1.8],
];

const pct = (v: number, total: number): string => `${(v / total) * 100}%`;

export function MapIllustration() {
  return (
    <div className="absolute inset-0">
      {/* Dotted canvas, like the real map. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, hsl(var(--muted-foreground) / 0.22) 1px, transparent 1px)",
          backgroundSize: "13px 13px",
          maskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black, transparent 92%)",
          WebkitMaskImage: "radial-gradient(ellipse 90% 90% at 50% 50%, black, transparent 92%)",
        }}
      />

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 size-full"
      >
        {EDGES.map(([a, b, delay], i) => {
          const p = node(a);
          const q = node(b);
          const d = `M ${p.x} ${p.y} L ${q.x} ${q.y}`;
          return (
            <g key={i}>
              <path
                id={`illo-map-e${i}`}
                d={d}
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
                className="illo-flow-dot fill-sky-500 [filter:drop-shadow(0_0_3px_rgb(14_165_233/0.7))]"
              >
                <animateMotion dur="2.6s" begin={`${delay}s`} repeatCount="indefinite">
                  <mpath href={`#illo-map-e${i}`} />
                </animateMotion>
              </circle>
            </g>
          );
        })}
      </svg>

      {NODES.map((n) => (
        <div
          key={n.id}
          className="absolute"
          style={{ left: pct(n.x, W), top: pct(n.y, H), transform: "translate(-50%, -50%)" }}
        >
          <div
            className="illo-float grid size-9 place-items-center rounded-lg border border-border bg-background shadow-sm"
            style={{ animationDelay: `${n.delay}s` }}
          >
            <CloudIcon name={n.logo} className="size-5" />
          </div>
        </div>
      ))}

      {/* Live freshness pill. */}
      <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-border bg-background/90 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground shadow-sm">
        <span className="relative flex size-1.5">
          <span className="illo-ripple absolute inline-flex size-full rounded-full bg-emerald-500/60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
        Live
      </div>
    </div>
  );
}
