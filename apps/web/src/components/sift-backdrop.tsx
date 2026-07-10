import { CloudIcon } from "@/components/cloud-icon";
import { cn } from "@/lib/cn";

/**
 * Decorative backdrop for the Sift page, split to match the pairing:
 *   - LEFT: a "contribution graph" of small green cells (Sift's GitHub-native world).
 *   - RIGHT: a slice of the Atlas infra map — real resource cards (icon tile + name + kind + a
 *     certainty dot) wired by curved edges, in the exact map-node style.
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
  { x: 40, y: 33, logo: "aws-lambda", name: "on-connect", short: "Lambda" },
  { x: 58, y: 18, logo: "aws-rds", name: "orders-db", short: "RDS" },
  { x: 84, y: 36, logo: "aws-ecs", name: "checkout-svc", short: "ECS Service" },
  { x: 60, y: 62, logo: "aws-s3", name: "assets", short: "S3 Bucket" },
  { x: 86, y: 82, logo: "github-icon", name: "web", short: "Repository" },
];
const NET_EDGES: [number, number][] = [
  [0, 1],
  [0, 3],
  [1, 2],
  [2, 3],
  [3, 4],
  [2, 4],
];

const GRID_MASK = "linear-gradient(to right, #000 0%, #000 12%, transparent 100%)";
const NET_MASK = "linear-gradient(to left, #000 0%, #000 12%, transparent 100%)";
const MUTED = "hsl(var(--muted-foreground))";

/** A smooth left→right bezier between two node anchors, like the map's default edges. */
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
}

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

      {/* Right — infra-map slice */}
      <div
        className="absolute inset-y-0 right-0 w-[42%] overflow-hidden"
        style={{ maskImage: NET_MASK, WebkitMaskImage: NET_MASK }}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {NET_EDGES.map(([a, b], i) => (
            <path
              key={i}
              d={edgePath(NET_NODES[a]!, NET_NODES[b]!)}
              fill="none"
              stroke={MUTED}
              strokeOpacity={0.3}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {NET_NODES.map((n, i) => (
          <div
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${n.x}%`, top: `${n.y}%`, width: 158 }}
          >
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 shadow-sm">
              <div className={cn("grid size-6 shrink-0 place-items-center rounded-md bg-muted/60")}>
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
