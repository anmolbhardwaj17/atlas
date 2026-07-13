import * as React from "react";
import { CloudIcon } from "@/components/cloud-icon";
import { cn } from "@/lib/cn";

/**
 * Decorative backdrop for the Sift page, split to match the pairing:
 *   - LEFT: a "contribution graph" of small green cells (Sift's GitHub-native world).
 *   - RIGHT: a slice of the Atlas infra map — real resource cards (icon tile + name + kind + a
 *     certainty dot) on a dotted canvas, wired by dashed, flowing edges, in the exact map style.
 * Each side bleeds in from its edge and is masked to fade to transparent by ~40% of the width, so
 * the centered copy stays clean. Deterministic (fixed layout) so SSR and client render identically.
 */

// ── Left: contribution grid ──────────────────────────────────────────────────────────────────
const CELLS = 1000;
const GREEN = "34, 197, 94"; // green-500

/** Stable per-cell opacity: mostly faint, a sparse few bright — the "streak" pops. */
function alphaFor(i: number): number {
  const h = (Math.imul(i + 1, 2654435761) >>> 0) % 1000;
  if (h < 32) return 0.42;
  if (h < 95) return 0.24;
  if (h < 230) return 0.12;
  return 0.05;
}

// ── Right: infra-map slice (coords in 0..100 of the right strip), laid out in left→right lanes:
//    repos → ingress → compute → data — so edges route cleanly like the real map. ──────────────
const NET_NODES: { x: number; y: number; logo: string; name: string; short: string }[] = [
  { x: 17, y: 28, logo: "github-icon", name: "payments-api", short: "Repository" }, // 0
  { x: 16, y: 56, logo: "bitbucket", name: "billing-svc", short: "Repository" }, // 1
  { x: 40, y: 15, logo: "aws-elb", name: "prod-alb", short: "Load Balancer" }, // 2
  { x: 42, y: 44, logo: "aws-api-gateway", name: "public-api", short: "API Gateway" }, // 3
  { x: 62, y: 26, logo: "aws-ecs", name: "checkout-svc", short: "ECS Service" }, // 4
  { x: 60, y: 55, logo: "aws-lambda", name: "on-connect", short: "Lambda" }, // 5
  { x: 58, y: 82, logo: "aws-lambda", name: "stream-worker", short: "Lambda" }, // 6
  { x: 86, y: 18, logo: "aws-rds", name: "orders-db", short: "RDS" }, // 7
  { x: 88, y: 44, logo: "aws-dynamodb", name: "sessions", short: "DynamoDB" }, // 8
  { x: 84, y: 67, logo: "aws-s3", name: "assets", short: "S3 Bucket" }, // 9
  { x: 82, y: 90, logo: "aws-elasticache", name: "cache", short: "ElastiCache" }, // 10
];
// Every edge runs left→right (source.x < target.x) so the orthogonal routing reads cleanly.
const NET_EDGES: [number, number][] = [
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 5],
  [3, 6],
  [4, 7],
  [4, 8],
  [4, 10],
  [5, 8],
  [5, 9],
  [6, 9],
  [6, 10],
];

const GRID_MASK = "linear-gradient(to right, #000 0%, #000 12%, transparent 100%)";
const NET_MASK = "linear-gradient(to left, #000 0%, #000 12%, transparent 100%)";
const MUTED = "hsl(var(--muted-foreground))";
/** Matches the map's dotted canvas (Dots variant: gap 22, muted/25%). */
const DOTS = {
  backgroundImage:
    "radial-gradient(circle, hsl(var(--muted-foreground) / 0.25) 1px, transparent 1.4px)",
  backgroundSize: "22px 22px",
};

/** Deterministic twinkle timing for a grid cell (SSR-stable). ~1 in 7 cells breathes. */
function twinkleFor(i: number): { on: boolean; delay: string; dur: string } {
  const h = (Math.imul(i + 7, 40503) >>> 0) % 1000;
  return {
    on: h < 150,
    delay: `-${(h % 50) / 10}s`, // 0–5s, negative so they're mid-cycle from the start
    dur: `${2.4 + (h % 33) / 10}s`, // 2.4–5.7s
  };
}

/**
 * The "contribution graph" of green cells — Sift's GitHub-native world. Standalone so the Sift setup
 * screen can reuse it as a left-hand backdrop. Deterministic (SSR-stable); ~1 in 7 cells twinkles.
 */
export function SiftContributionGrid({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div aria-hidden className={cn("overflow-hidden", className)} style={style}>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(auto-fill, 26px)", gridAutoRows: "26px" }}
      >
        {Array.from({ length: CELLS }).map((_, i) => {
          const t = twinkleFor(i);
          return (
            <span
              key={i}
              className={t.on ? "sift-cell rounded-[5px]" : "rounded-[5px]"}
              style={{
                backgroundColor: `rgba(${GREEN}, ${alphaFor(i)})`,
                ...(t.on ? { animationDelay: t.delay, animationDuration: t.dur } : {}),
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SiftBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Left — contribution grid */}
      <SiftContributionGrid
        className="absolute inset-y-0 left-0 w-[42%]"
        style={{ maskImage: GRID_MASK, WebkitMaskImage: GRID_MASK }}
      />

      {/* Right — infra-map slice (dotted canvas + dashed, flowing edges + real resource cards) */}
      <div
        className="absolute inset-y-0 right-0 w-[42%] overflow-hidden"
        style={{ maskImage: NET_MASK, WebkitMaskImage: NET_MASK }}
      >
        <div className="absolute inset-0" style={DOTS} />
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {NET_EDGES.map(([a, b], i) => (
            <line
              key={i}
              x1={NET_NODES[a]!.x}
              y1={NET_NODES[a]!.y}
              x2={NET_NODES[b]!.x}
              y2={NET_NODES[b]!.y}
              className="sift-edge"
              stroke={MUTED}
              strokeOpacity={0.55}
              strokeWidth={1.4}
              strokeDasharray="6 6"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {NET_NODES.map((n, i) => (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${n.x}%`, top: `${n.y}%`, width: 150 }}
          >
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-sm">
              <div className="grid size-6 shrink-0 place-items-center rounded-md bg-muted/60">
                <CloudIcon name={n.logo} className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium leading-tight">{n.name}</div>
                <div className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
                  {n.short}
                </div>
              </div>
              <span className="size-1.5 shrink-0 rounded-full bg-foreground" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
