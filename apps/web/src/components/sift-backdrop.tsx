import { CloudIcon } from "@/components/cloud-icon";

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

// ── Right: infra-map slice (coords in 0..100 of the right strip) ──────────────────────────────
const NET_NODES: { x: number; y: number; logo: string; name: string; short: string }[] = [
  { x: 24, y: 30, logo: "github-icon", name: "payments-api", short: "Repository" },
  { x: 46, y: 15, logo: "aws-elb", name: "prod-alb", short: "Load Balancer" },
  { x: 42, y: 46, logo: "aws-api-gateway", name: "public-api", short: "API Gateway" },
  { x: 64, y: 24, logo: "aws-ecs", name: "checkout-svc", short: "ECS Service" },
  { x: 59, y: 53, logo: "aws-lambda", name: "on-connect", short: "Lambda" },
  { x: 50, y: 75, logo: "aws-lambda", name: "stream-worker", short: "Lambda" },
  { x: 87, y: 17, logo: "aws-rds", name: "orders-db", short: "RDS" },
  { x: 90, y: 43, logo: "aws-dynamodb", name: "sessions", short: "DynamoDB" },
  { x: 82, y: 65, logo: "aws-s3", name: "assets", short: "S3 Bucket" },
  { x: 73, y: 86, logo: "aws-elasticache", name: "cache", short: "ElastiCache" },
];
const NET_EDGES: [number, number][] = [
  [0, 3],
  [1, 3],
  [1, 2],
  [2, 4],
  [2, 5],
  [3, 6],
  [3, 7],
  [3, 9],
  [4, 7],
  [4, 8],
  [5, 8],
  [5, 9],
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

export function SiftBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Left — contribution grid */}
      <div
        className="absolute inset-y-0 left-0 w-[42%] overflow-hidden"
        style={{ maskImage: GRID_MASK, WebkitMaskImage: GRID_MASK }}
      >
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, 26px)", gridAutoRows: "26px" }}
        >
          {Array.from({ length: CELLS }).map((_, i) => (
            <span
              key={i}
              className="rounded-[5px]"
              style={{ backgroundColor: `rgba(${GREEN}, ${alphaFor(i)})` }}
            />
          ))}
        </div>
      </div>

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
