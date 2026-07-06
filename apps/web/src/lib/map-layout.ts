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

  // Partition: nodes with a visible edge join the dagre flow; the rest (real estate too -
  // an unhealthy isolated bucket still matters) go into a labelled shelf below the flow
  // instead of being silently dropped. People/PR cards stay out of the shelf - they are
  // code-activity, not infrastructure.
  const linked = new Set<string>();
  for (const e of mapEdges) {
    if (byId.has(e.from) && byId.has(e.to)) {
      linked.add(e.from);
      linked.add(e.to);
    }
  }
  const flowNodes = mapNodes.filter((n) => linked.has(n.id));
  const shelfNodes = mapNodes.filter(
    (n) => !linked.has(n.id) && !/\.(user|pullrequest|pull_request)$/.test(n.kind),
  );

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 26, ranksep: 110, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of flowNodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of mapEdges) {
    if (linked.has(e.from) && linked.has(e.to)) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);

  const outNodes: Node[] = flowNodes.map((n) => {
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

  // The shelf: a fixed grid inside a labelled dashed frame, below the flow's bounding box.
  if (shelfNodes.length > 0) {
    let maxX = 0;
    let maxY = 0;
    for (const nd of outNodes) {
      maxX = Math.max(maxX, nd.position.x + NODE_W);
      maxY = Math.max(maxY, nd.position.y + NODE_H);
    }
    const GAP_X = 24;
    const GAP_Y = 20;
    const PAD = 24;
    const HEADER = 34;
    const cols = Math.max(3, Math.min(6, Math.floor((maxX || 900) / (NODE_W + GAP_X)) || 4));
    const rows = Math.ceil(shelfNodes.length / cols);
    const shelfW = cols * NODE_W + (cols - 1) * GAP_X + PAD * 2;
    const shelfH = rows * NODE_H + (rows - 1) * GAP_Y + HEADER + PAD * 2;
    const shelfY = maxY + 72;

    outNodes.push({
      id: "shelf-unconnected",
      type: "envLane",
      position: { x: 0, y: shelfY },
      data: { label: "No observed connections yet", count: shelfNodes.length },
      draggable: false,
      selectable: false,
      width: shelfW,
      height: shelfH,
      style: { width: shelfW, height: shelfH, zIndex: 0 },
    });
    shelfNodes.forEach((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      outNodes.push({
        id: n.id,
        type: "resource",
        position: {
          x: PAD + col * (NODE_W + GAP_X),
          y: shelfY + HEADER + PAD + row * (NODE_H + GAP_Y),
        },
        data: { node: n },
        draggable: false,
        width: NODE_W,
        height: NODE_H,
        style: { zIndex: 1 },
      });
    });
  }

  // "Flow" edges carry traffic/data → animate them so the map feels alive; structural edges
  // (CONTAINS/OWNED_BY/…) stay static so the motion means something.
  const FLOW_TYPES = new Set(["CONNECTS_TO", "ROUTES_TO", "DEPLOYS_TO", "STORES_IN", "DEPENDS_ON"]);

  // Merge every edge between the same PAIR of nodes into one drawn line. Two nodes often
  // relate twice in opposite directions (bucket -stores in-> lambda + lambda -connects to->
  // bucket); the backward one fights the LR layout and smoothstep wraps it clear around the
  // row, skewering unrelated cards at handle height. One line per pair, labelled with every
  // relationship on hover; observed beats inferred for the line style; the detail panel
  // still lists each relationship individually.
  const byPair = new Map<string, MapEdge[]>();
  for (const e of mapEdges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    const key = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
    const arr = byPair.get(key);
    if (arr) arr.push(e);
    else byPair.set(key, [e]);
  }

  const edges: Edge[] = [...byPair.values()].map((group) => {
    const primary = group.find((g) => g.origin === "observed") ?? (group[0] as MapEdge);
    const inferred = group.every((g) => g.origin !== "observed");
    const cross = edgeCrossing(byId.get(primary.from), byId.get(primary.to));
    const boundary = cross.crossCloud || cross.crossAccount;
    const types = [...new Set(group.map((g) => g.type.toLowerCase().replace(/_/g, " ")))].join(
      " · ",
    );
    const label = boundary
      ? `${cross.crossCloud ? "cross-cloud" : "cross-account"} · ${types}`
      : types;
    return {
      id: primary.id,
      source: primary.from,
      target: primary.to,
      type: "smoothstep",
      // Cross-boundary links are the point of a multi-cloud graph → always animate + accent.
      animated: boundary || group.some((g) => FLOW_TYPES.has(g.type)),
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
