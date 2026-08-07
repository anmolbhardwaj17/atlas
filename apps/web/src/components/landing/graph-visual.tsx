"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CloudIcon } from "@/components/cloud-icon";
import { kindIcon, kindStyle, kindShort, KIND_LOGO } from "@/lib/kind-visual";

/**
 * The hero graph — a real cross-provider slice of an Atlas map.
 *
 * Built from the SAME anatomy as the live canvas (`components/map/resource-node.tsx`): the 190px
 * card, the `size-7` logo chip that falls back to the kind's tinted lucide glyph, the name over an
 * uppercase `kindShort` line, the certainty dot, and the lift-on-hover. Kinds
 * are real kind strings, so the logos come from the same `KIND_LOGO` table the product uses — this
 * is the map, not a drawing of the map.
 *
 * The canvas is the map's own: a light surface with the same dotted background (gap 22, size 1.6)
 * the live React Flow canvas draws, applied by the page. Same nodes, same grid, same ink.
 *
 * Hovering a node dims everything it isn't connected to and lights its edges, which is exactly what
 * the real map does on hover. That makes the hero demonstrate the interaction rather than describe
 * it, and it's the cheapest honest way to show what "one live graph" actually buys you.
 *
 * Deliberately spans four providers — AWS, Google Cloud, Bitbucket and Jira — because the single
 * thing Atlas does that a per-provider console cannot is put them on one canvas: the Jira ticket
 * that became the pull request that shipped the service that talks to the database.
 */
interface LNode {
  id: string;
  name: string;
  kind: string;
  certainty: "observed" | "inferred-high" | "inferred-low";
  x: number;
  y: number;
}

const W = 200;
const H = 56;
const CANVAS_W = 965;
const CANVAS_H = 376;
/** Lane headings sit above the first row — the live map frames nodes into lanes; so does this. */
const LANE_Y = 0;
const ROW0 = 34;
/** Below this the node labels stop being readable, so we scroll rather than shrink further. */
const MIN_SCALE = 0.62;

/** Mirrors resource-node.tsx CERTAINTY exactly — solid = observed, faded = inferred, ring = low. */
const CERTAINTY_DOT: Record<string, string> = {
  observed: "bg-foreground",
  "inferred-high": "bg-foreground/50",
  "inferred-low": "bg-transparent ring-1 ring-inset ring-muted-foreground/50",
};

const NODES: LNode[] = [
  // Lane 1 — plan & code: where a change starts.
  { id: "ticket", name: "PAY-318", kind: "jira.issue", certainty: "observed", x: 0, y: ROW0 },
  {
    id: "repo",
    name: "checkout-api",
    kind: "bitbucket.repository",
    certainty: "observed",
    x: 0,
    y: ROW0 + 84,
  },
  {
    id: "pipe",
    name: "deploy-production",
    kind: "bitbucket.pipeline",
    certainty: "observed",
    x: 0,
    y: ROW0 + 168,
  },
  {
    id: "repo2",
    name: "reports-service",
    kind: "bitbucket.repository",
    certainty: "observed",
    x: 0,
    y: ROW0 + 252,
  },

  // Lane 2 — how traffic reaches you.
  {
    id: "dns",
    name: "api.acme.com",
    kind: "aws.route53.record",
    certainty: "observed",
    x: 255,
    y: ROW0,
  },
  { id: "alb", name: "checkout-alb", kind: "aws.elb", certainty: "observed", x: 255, y: ROW0 + 84 },

  // Lane 3 — what runs.
  {
    id: "svc",
    name: "checkout",
    kind: "aws.ecs.service",
    certainty: "observed",
    x: 510,
    y: ROW0 + 42,
  },
  {
    id: "fn",
    name: "orders-webhook",
    kind: "aws.lambda.function",
    certainty: "inferred-high",
    x: 510,
    y: ROW0 + 126,
  },
  {
    id: "run",
    name: "reports-renderer",
    kind: "gcp.run.service",
    certainty: "inferred-low",
    x: 510,
    y: ROW0 + 252,
  },

  // Lane 4 — what it keeps.
  { id: "db", name: "orders-db", kind: "aws.rds.instance", certainty: "observed", x: 765, y: ROW0 },
  {
    id: "ddb",
    name: "orders-events",
    kind: "aws.dynamodb.table",
    certainty: "observed",
    x: 765,
    y: ROW0 + 84,
  },
  {
    id: "cache",
    name: "checkout-sessions",
    kind: "aws.elasticache.cluster",
    certainty: "observed",
    x: 765,
    y: ROW0 + 168,
  },
  {
    id: "s3",
    name: "checkout-assets",
    kind: "aws.s3.bucket",
    certainty: "observed",
    x: 765,
    y: ROW0 + 252,
  },
];

/** Lane headings. Without them the four columns are just columns; with them the canvas reads
 *  left-to-right as a sentence — a change ships to something that runs and keeps state. */
const LANES: Array<{ label: string; x: number }> = [
  { label: "Plan & code", x: 0 },
  { label: "Traffic", x: 255 },
  { label: "Compute", x: 510 },
  { label: "Data", x: 765 },
];

interface LEdge {
  from: string;
  to: string;
  label: string;
  /** Inferred links are dashed — the certainty language, on the canvas. */
  inferred?: boolean;
}

const EDGES: LEdge[] = [
  { from: "ticket", to: "repo", label: "IMPLEMENTED_BY" },
  { from: "repo", to: "pipe", label: "CONTAINS" },
  { from: "pipe", to: "svc", label: "DEPLOYS_TO", inferred: true },
  { from: "repo2", to: "run", label: "DEPLOYS_TO", inferred: true },
  { from: "dns", to: "alb", label: "ROUTES_TO" },
  { from: "alb", to: "svc", label: "ROUTES_TO" },
  { from: "svc", to: "db", label: "STORES_IN" },
  { from: "svc", to: "ddb", label: "PUBLISHES_TO" },
  { from: "svc", to: "cache", label: "CACHES_IN" },
  { from: "svc", to: "s3", label: "STORES_IN" },
  { from: "svc", to: "fn", label: "INVOKES", inferred: true },
  { from: "fn", to: "db", label: "STORES_IN" },
  { from: "svc", to: "run", label: "CALLS", inferred: true },
];

const byId = (id: string): LNode => NODES.find((n) => n.id === id) as LNode;

/** Orthogonal connector, right edge → left edge, matching the map's step edges. */
function edgePath(a: LNode, b: LNode): string {
  const x1 = a.x + W;
  const y1 = a.y + H / 2;
  const x2 = b.x;
  const y2 = b.y + H / 2;
  if (Math.abs(y1 - y2) < 2) return `M ${x1} ${y1} H ${x2}`;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
}

/** Vertical connector for the stacked left column (ticket → repo → pipeline). */
function stackPath(a: LNode, b: LNode): string {
  const x = a.x + 26;
  return `M ${x} ${a.y + H} V ${b.y}`;
}

export function GraphVisual() {
  const [active, setActive] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);

  // Everything the hovered node touches, so the rest can recede — the map's blast-radius focus.
  const related = new Set<string>();
  if (active) {
    related.add(active);
    for (const e of EDGES) {
      if (e.from === active) related.add(e.to);
      if (e.to === active) related.add(e.from);
    }
  }
  // An edge hover pins exactly its two endpoints, so the rest recedes the same way a node hover does.
  const he = hoverEdge !== null ? (EDGES[hoverEdge] as LEdge) : null;
  if (he) {
    related.clear();
    related.add(he.from);
    related.add(he.to);
  }
  const focused = active !== null || he !== null;
  const dimmed = (id: string): boolean => focused && !related.has(id);
  const edgeActive = (e: LEdge, i: number): boolean =>
    i === hoverEdge || (active !== null && (e.from === active || e.to === active));

  // Scale the whole canvas to whatever width it's given, down to a floor. Below the floor the text
  // would stop being readable, so past that point it scrolls instead — shrinking further would
  // "fit" while making the diagram useless.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? CANVAS_W;
      setScale(Math.min(1, Math.max(MIN_SCALE, w / CANVAS_W)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="w-full overflow-x-auto">
      <div style={{ height: CANVAS_H * scale, width: CANVAS_W * scale }} className="mx-auto">
        <div
          style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
          className="origin-top-left"
        >
          {renderCanvas()}
        </div>
      </div>
    </div>
  );

  function renderCanvas() {
    return (
      <div
        className="relative select-none"
        style={{ width: CANVAS_W, height: CANVAS_H }}
        onMouseLeave={() => {
          setActive(null);
          setHoverEdge(null);
        }}
      >
        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="lg-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="5"
              markerHeight="5"
              orient="auto"
            >
              <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
            </marker>
          </defs>
          {EDGES.map((e, i) => {
            const a = byId(e.from);
            const b = byId(e.to);
            const vertical = a.x === b.x;
            const on = edgeActive(e, i);
            const off = focused && !on;
            return (
              <g
                key={`${e.from}-${e.to}`}
                className={cn(
                  "lg-edge transition-[opacity,color] duration-200",
                  on ? "text-foreground/80" : "text-muted-foreground/75",
                  off && "opacity-25",
                )}
                style={{ ["--d" as string]: `${0.1 + i * 0.08}s` }}
              >
                <path
                  d={vertical ? stackPath(a, b) : edgePath(a, b)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={on ? 1.75 : 1.25}
                  strokeDasharray={e.inferred ? "5 4" : undefined}
                  className={e.inferred ? "lg-march" : undefined}
                  markerEnd="url(#lg-arrow)"
                />
                {/* Flow pulse, riding the same path. Direction reads without an arrow being the only
                  cue, and it makes a static diagram feel like something currently connected. */}
                <path
                  d={vertical ? stackPath(a, b) : edgePath(a, b)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  className="pointer-events-auto cursor-default"
                  onMouseEnter={() => setHoverEdge(i)}
                  onMouseLeave={() => setHoverEdge(null)}
                />
                {!e.inferred ? (
                  <path
                    className="lg-flow"
                    d={vertical ? stackPath(a, b) : edgePath(a, b)}
                    pathLength={1}
                    fill="none"
                    strokeWidth={on ? 2.5 : 2}
                    strokeLinecap="round"
                    style={{ ["--fd" as string]: `${(i % 5) * 0.45}s` }}
                  />
                ) : null}
                {on ? (
                  <text
                    x={vertical ? a.x + 34 : a.x + W + (b.x - (a.x + W)) / 2}
                    y={vertical ? a.y + H + (b.y - (a.y + H)) / 2 + 3 : (a.y + b.y) / 2 + H / 2 - 9}
                    textAnchor={vertical ? "start" : "middle"}
                    fill="currentColor"
                    fontSize="9.5"
                    className="fill-foreground font-medium tracking-wide [paint-order:stroke] [stroke-linejoin:round] [stroke-width:5px] [stroke:hsl(var(--card))]"
                  >
                    {e.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {LANES.map((l) => (
          <div
            key={l.label}
            className="absolute text-[10px] font-medium uppercase tracking-widest text-muted-foreground/70"
            style={{ left: l.x, top: LANE_Y, width: W }}
          >
            {l.label}
          </div>
        ))}

        {NODES.map((n, i) => {
          const logo = KIND_LOGO[n.kind];
          const Icon = kindIcon(n.kind);
          const on = active === n.id;
          return (
            <button
              key={n.id}
              type="button"
              tabIndex={-1}
              onMouseEnter={() => setActive(n.id)}
              onFocus={() => setActive(n.id)}
              className={cn(
                "lg-node absolute flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 text-left shadow-sm",
                "transition-[transform,box-shadow,border-color,opacity] duration-200",
                on
                  ? "-translate-y-0.5 border-foreground shadow-md ring-1 ring-foreground"
                  : "border-border hover:border-foreground/40",
                dimmed(n.id) && "opacity-30",
              )}
              style={{ left: n.x, top: n.y, width: W, ["--d" as string]: `${0.2 + i * 0.09}s` }}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-md",
                  logo ? "bg-muted/60" : kindStyle(n.kind),
                )}
              >
                {logo ? (
                  <CloudIcon name={logo} className="size-[18px]" />
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium leading-tight">{n.name}</span>
                <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {kindShort(n.kind)}
                </span>
              </span>
              <span
                className={cn("size-1.5 shrink-0 rounded-full", CERTAINTY_DOT[n.certainty])}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    );
  }
}
