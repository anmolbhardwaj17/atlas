/**
 * The hero visual: a small, real slice of an Atlas graph.
 *
 * Deliberately not an abstract "network of glowing dots" — that decoration says nothing, and every
 * infrastructure product has one. This draws the actual shape Atlas produces: a repository that
 * deploys to a service, which publishes to a queue and stores data in a database, with the pull
 * request that shipped it attached. Edges carry the real relationship names the product uses, and
 * are dashed where the link is *inferred* rather than observed — so the picture teaches the
 * certainty language before the visitor has read a word about it.
 *
 * A server component with no client JavaScript: the motion is pure CSS (globals.css, `.lg-*`),
 * runs on mount like every other entrance in the app, and is skipped entirely under
 * `prefers-reduced-motion` — where the un-animated default is the finished diagram.
 */
interface Node {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  /** Arrival order — a node must never appear before the edge that leads to it. */
  step: number;
}

const NODES: Node[] = [
  { id: "repo", label: "checkout-api", kind: "Repository", x: 60, y: 78, step: 1 },
  { id: "pr", label: "#1482", kind: "Pull request", x: 60, y: 196, step: 2 },
  { id: "svc", label: "checkout", kind: "ECS service", x: 299, y: 130, step: 3 },
  { id: "queue", label: "orders-events", kind: "SQS queue", x: 538, y: 62, step: 4 },
  { id: "db", label: "orders-db", kind: "RDS instance", x: 538, y: 198, step: 4 },
];

interface Edge {
  from: string;
  to: string;
  /** Observed = read straight from the source. Inferred = worked out, so it's drawn dashed. */
  inferred?: boolean;
  step: number;
}

const EDGES: Edge[] = [
  { from: "repo", to: "svc", inferred: true, step: 1 },
  { from: "pr", to: "svc", inferred: true, step: 2 },
  { from: "svc", to: "queue", step: 3 },
  { from: "svc", to: "db", step: 3 },
];

const NODE_W = 132;
const NODE_H = 48;

const byId = (id: string): Node => NODES.find((n) => n.id === id) as Node;

/** Orthogonal path from the right edge of `from` to the left edge of `to`. */
function path(from: Node, to: Node): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const mid = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`;
}

export function GraphVisual() {
  return (
    <svg
      viewBox="0 0 730 290"
      className="h-auto w-full"
      role="img"
      aria-label="A slice of an Atlas graph: the checkout-api repository and pull request 1482 deploy to the checkout ECS service, which publishes to the orders-events queue and stores data in the orders database."
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
          <path d="M0 0 L8 4 L0 8 z" fill="rgba(255,255,255,0.3)" />
        </marker>
      </defs>

      {EDGES.map((e) => (
        <path
          key={`${e.from}-${e.to}`}
          d={path(byId(e.from), byId(e.to))}
          className={e.inferred ? "lg-edge lg-inferred" : "lg-edge"}
          style={{ ["--d" as string]: `${0.1 + e.step * 0.2}s` }}
          fill="none"
          stroke="rgba(255,255,255,0.26)"
          strokeWidth="1.5"
          strokeDasharray={e.inferred ? "5 4" : undefined}
          markerEnd="url(#lg-arrow)"
        />
      ))}

      {NODES.map((n) => (
        <g key={n.id} className="lg-node" style={{ ["--d" as string]: `${0.24 + n.step * 0.2}s` }}>
          <rect
            x={n.x}
            y={n.y}
            width={NODE_W}
            height={NODE_H}
            rx="10"
            fill="rgba(255,255,255,0.07)"
            stroke="rgba(255,255,255,0.13)"
          />
          <text
            x={n.x + 14}
            y={n.y + 21}
            fill="rgba(255,255,255,0.94)"
            fontSize="12.5"
            fontWeight="500"
          >
            {n.label}
          </text>
          <text x={n.x + 14} y={n.y + 36} fill="rgba(255,255,255,0.4)" fontSize="10.5">
            {n.kind}
          </text>
        </g>
      ))}
    </svg>
  );
}
