import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { edgeCrossing, CROSS_COLOR, type MapEdge, type MapNode } from "./map-types";

/**
 * Pure layout for the infra map: ONE left-to-right dagre flow over the whole visible graph,
 * with EVERY edge participating in ranking. That is what makes the map read like an
 * architecture diagram - traffic enters on the left (load balancers, security groups,
 * containers) and flows right through compute into datastores. The previous lane-per-
 * environment layout ranked only intra-lane edges, so most real relationships (which cross
 * lanes) didn't shape the layout at all - nodes piled into vertical columns and edges drew
 * as long detached rails. Environment lanes are disabled for now (single-env estates);
 * revisit grouping when a customer actually has multiple environments.
 * Deterministic → stable across renders.
 */
const NODE_W = 190;
const NODE_H = 56;

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

export function buildLayout(mapNodes: MapNode[], mapEdges: MapEdge[]): LayoutResult {
  const byId = new Map(mapNodes.map((n) => [n.id, n]));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 110, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of mapNodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of mapEdges) {
    if (byId.has(e.from) && byId.has(e.to)) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  const outNodes: Node[] = mapNodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: "resource",
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: { node: n },
      draggable: false,
      width: NODE_W,
      height: NODE_H,
      style: { zIndex: 1 },
    };
  });

  // "Flow" edges carry traffic/data → animate them so the map feels alive; structural edges
  // (CONTAINS/PROTECTS/OWNED_BY/…) stay static so the motion means something.
  const FLOW_TYPES = new Set(["CONNECTS_TO", "ROUTES_TO", "DEPLOYS_TO", "STORES_IN", "DEPENDS_ON"]);

  const edges: Edge[] = mapEdges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => {
      const inferred = e.origin !== "observed";
      const cross = edgeCrossing(byId.get(e.from), byId.get(e.to));
      const boundary = cross.crossCloud || cross.crossAccount;
      const label = boundary
        ? `${cross.crossCloud ? "cross-cloud" : "cross-account"} · ${e.type.toLowerCase().replace(/_/g, " ")}`
        : e.type.toLowerCase().replace(/_/g, " ");
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        // Cross-boundary links are the point of a multi-cloud graph → always animate + accent.
        animated: boundary || FLOW_TYPES.has(e.type),
        // No always-on labels: repeated generic captions ("connects to" ×5) are noise and
        // detach from long paths. The canvas reveals the label on hover/selection instead
        // (decorateEdges in infra-map); solid-vs-dashed already encodes observed/inferred.
        data: { label },
        zIndex: boundary ? 5 : 1,
        style: {
          stroke: boundary
            ? CROSS_COLOR
            : inferred
              ? "hsl(var(--muted-foreground))"
              : "hsl(var(--foreground))",
          strokeWidth: boundary ? 2.25 : 1.5,
          strokeDasharray: inferred && !boundary ? "5 4" : undefined,
          opacity: boundary ? 1 : inferred ? 0.7 : 0.9,
        },
      };
    });

  return { nodes: outNodes, edges };
}
