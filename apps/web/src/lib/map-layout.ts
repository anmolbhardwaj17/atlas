import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { ENV_ORDER, ENV_LABEL, type MapEdge, type MapNode } from "./map-types";

/**
 * Pure layout for the infra map: group resources into environment lanes (Production /
 * Staging / … / Code & shared), auto-layout each lane's subgraph left-to-right with dagre,
 * then stack the lanes and frame each with a labeled group box. Positions are absolute (no
 * React Flow parent/child) so cross-environment edges (e.g. a repo → a prod service) draw
 * cleanly across the frames. Deterministic → the map is stable across renders.
 */
const NODE_W = 190;
const NODE_H = 56;
const HEADER_H = 34;
const PAD = 24;
const LANE_GAP = 48;
const MIN_LANE_W = 360;

export interface LayoutResult {
  nodes: Node[];
  edges: Edge[];
}

export function buildLayout(mapNodes: MapNode[], mapEdges: MapEdge[]): LayoutResult {
  const byId = new Map(mapNodes.map((n) => [n.id, n]));
  // Group nodes by environment (anything outside the known set → "unknown").
  const groups = new Map<string, MapNode[]>();
  for (const n of mapNodes) {
    const env = ENV_ORDER.includes(n.environment as (typeof ENV_ORDER)[number])
      ? n.environment
      : "unknown";
    let bucket = groups.get(env);
    if (!bucket) {
      bucket = [];
      groups.set(env, bucket);
    }
    bucket.push(n);
  }

  const outNodes: Node[] = [];
  let cursorY = 0;

  for (const env of ENV_ORDER) {
    const laneNodes = groups.get(env);
    if (!laneNodes || laneNodes.length === 0) continue;
    const ids = new Set(laneNodes.map((n) => n.id));

    // Lay out this lane's internal edges only (cross-lane edges just render, don't rank).
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 72, marginx: 8, marginy: 8 });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of laneNodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
    for (const e of mapEdges) {
      if (ids.has(e.from) && ids.has(e.to)) g.setEdge(e.from, e.to);
    }
    dagre.layout(g);

    // Normalize dagre coords so the lane starts at (0,0), then offset into the frame.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of laneNodes) {
      const pos = g.node(n.id);
      minX = Math.min(minX, pos.x - NODE_W / 2);
      minY = Math.min(minY, pos.y - NODE_H / 2);
      maxX = Math.max(maxX, pos.x + NODE_W / 2);
      maxY = Math.max(maxY, pos.y + NODE_H / 2);
    }
    const laneW = Math.max(MIN_LANE_W, maxX - minX + PAD * 2);
    const laneH = maxY - minY + HEADER_H + PAD * 2;

    outNodes.push({
      id: `lane-${env}`,
      type: "envLane",
      position: { x: 0, y: cursorY },
      data: { label: ENV_LABEL[env] ?? env, count: laneNodes.length },
      draggable: false,
      selectable: false,
      // Explicit dimensions so React Flow renders immediately (no measure-then-reveal).
      width: laneW,
      height: laneH,
      style: { width: laneW, height: laneH, zIndex: 0 },
    });

    for (const n of laneNodes) {
      const pos = g.node(n.id);
      outNodes.push({
        id: n.id,
        type: "resource",
        position: {
          x: PAD + (pos.x - NODE_W / 2 - minX),
          y: cursorY + HEADER_H + PAD + (pos.y - NODE_H / 2 - minY),
        },
        data: { node: n },
        draggable: false,
        width: NODE_W,
        height: NODE_H,
        style: { zIndex: 1 },
      });
    }
    cursorY += laneH + LANE_GAP;
  }

  // "Flow" edges carry traffic/data → animate them so the map feels alive; structural edges
  // (CONTAINS/PROTECTS/OWNED_BY/…) stay static so the motion means something.
  const FLOW_TYPES = new Set(["CONNECTS_TO", "ROUTES_TO", "DEPLOYS_TO", "STORES_IN", "DEPENDS_ON"]);

  const edges: Edge[] = mapEdges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => {
      const inferred = e.origin !== "observed";
      return {
        id: e.id,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        animated: FLOW_TYPES.has(e.type),
        label: e.type.toLowerCase().replace(/_/g, " "),
        labelShowBg: true,
        style: {
          stroke: inferred ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
          strokeWidth: 1.5,
          strokeDasharray: inferred ? "5 4" : undefined,
          opacity: inferred ? 0.7 : 0.9,
        },
      };
    });

  return { nodes: outNodes, edges };
}
