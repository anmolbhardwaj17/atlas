"use client";

import { Globe, Server, Cpu, Boxes, Database, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * "Live infrastructure map" illustration — a mini node graph that mirrors the real map: an entry
 * point flowing through compute into a datastore, with pulses travelling the edges to signal the
 * continuously-updated, live nature of the graph. SVG edges (in a 2:1 viewBox) + HTML node chips
 * positioned by percentage so the two layers stay aligned at any size.
 */

const W = 300;
const H = 150;

interface GraphNode {
  id: string;
  x: number;
  y: number;
  icon: LucideIcon;
  tint: string;
  delay: number;
}

const NODES: GraphNode[] = [
  { id: "entry", x: 32, y: 75, icon: Globe, tint: "text-sky-500", delay: 0 },
  { id: "api", x: 110, y: 75, icon: Server, tint: "text-sky-500", delay: 0.7 },
  { id: "svcA", x: 194, y: 42, icon: Cpu, tint: "text-violet-500", delay: 1.2 },
  { id: "svcB", x: 194, y: 108, icon: Boxes, tint: "text-violet-500", delay: 0.35 },
  { id: "db", x: 270, y: 75, icon: Database, tint: "text-emerald-500", delay: 0.95 },
];
const node = (id: string): GraphNode => NODES.find((n) => n.id === id) ?? NODES[0]!;

/** [from, to, pulse-start-delay(s)] */
const EDGES: Array<[string, string, number]> = [
  ["entry", "api", 0],
  ["api", "svcA", 0.5],
  ["api", "svcB", 0.9],
  ["svcA", "db", 1.3],
  ["svcB", "db", 1.7],
];

export function MapIllustration() {
  return (
    <div className="absolute inset-0">
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
                strokeOpacity={0.35}
                strokeWidth={1.25}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                r={2.4}
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

      {NODES.map((n) => {
        const Icon = n.icon;
        return (
          <div
            key={n.id}
            className="absolute"
            style={{
              left: `${(n.x / W) * 100}%`,
              top: `${(n.y / H) * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className="illo-float grid size-8 place-items-center rounded-lg border border-border bg-background shadow-sm"
              style={{ animationDelay: `${n.delay}s` }}
            >
              <Icon className={cn("size-4", n.tint)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
