/**
 * Decorative backdrop for the Sift page, split to match the pairing:
 *   - LEFT: a "contribution graph" of small green cells (Sift's GitHub-native world).
 *   - RIGHT: a node network in the Atlas map style (the knowledge graph).
 * Each side bleeds in from its edge and is masked to fade to transparent through the middle, so the
 * centered copy stays clean. Deterministic (index-hashed / fixed layout, no randomness) so SSR and
 * client render identically.
 */

// ── Left: contribution grid ──────────────────────────────────────────────────────────────────
const CELLS = 1200;
const GREEN = "34, 197, 94"; // green-500

/** Stable per-cell opacity: mostly faint, a sparse few bright — the "streak" pops. */
function alphaFor(i: number): number {
  const h = (Math.imul(i + 1, 2654435761) >>> 0) % 1000;
  if (h < 32) return 0.42;
  if (h < 95) return 0.24;
  if (h < 230) return 0.12;
  return 0.05;
}

// ── Right: node network (fixed layout, coords in 0..100 of the right strip) ───────────────────
const NODES: { x: number; y: number; d: number; accent?: boolean }[] = [
  { x: 95, y: 18, d: 10 },
  { x: 72, y: 30, d: 9 },
  { x: 88, y: 46, d: 13, accent: true },
  { x: 60, y: 55, d: 9 },
  { x: 82, y: 68, d: 10 },
  { x: 46, y: 24, d: 8 },
  { x: 50, y: 44, d: 11 },
  { x: 58, y: 78, d: 9 },
  { x: 40, y: 61, d: 12, accent: true },
  { x: 30, y: 38, d: 8 },
  { x: 74, y: 88, d: 9 },
  { x: 96, y: 62, d: 10 },
];
const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
  [1, 5],
  [2, 3],
  [2, 11],
  [3, 6],
  [3, 4],
  [4, 10],
  [4, 11],
  [5, 6],
  [6, 8],
  [6, 9],
  [7, 8],
  [7, 10],
  [8, 3],
  [9, 5],
];

const GRID_MASK = "linear-gradient(to right, #000 0%, #000 14%, transparent 100%)";
const NET_MASK = "linear-gradient(to left, #000 0%, #000 14%, transparent 100%)";
const MUTED = "hsl(var(--muted-foreground))";

export function SiftBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Left — contribution grid */}
      <div
        className="absolute inset-y-0 left-0 w-[52%] overflow-hidden"
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

      {/* Right — node network */}
      <div
        className="absolute inset-y-0 right-0 w-[52%] overflow-hidden"
        style={{ maskImage: NET_MASK, WebkitMaskImage: NET_MASK }}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {EDGES.map(([a, b], i) => (
            <line
              key={i}
              x1={NODES[a]!.x}
              y1={NODES[a]!.y}
              x2={NODES[b]!.x}
              y2={NODES[b]!.y}
              stroke={MUTED}
              strokeOpacity={0.28}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {NODES.map((n, i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{
              left: `${n.x}%`,
              top: `${n.y}%`,
              width: n.d,
              height: n.d,
              backgroundColor: n.accent ? "hsl(var(--primary))" : "hsl(var(--background))",
              borderColor: n.accent ? "hsl(var(--primary))" : MUTED,
              opacity: n.accent ? 0.55 : 0.5,
            }}
          />
        ))}
      </div>
    </div>
  );
}
