"use client";

import "@xyflow/react/dist/style.css";
import * as React from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import { buildLayout } from "@/lib/map-layout";
import { ResourceNode, EnvLaneNode } from "@/components/map/resource-node";
import type { MapData, MapNode } from "@/lib/map-types";

const nodeTypes = { resource: ResourceNode, envLane: EnvLaneNode };
const HOT = "hsl(var(--danger))";

/** The visible slice: the focal node + its immediate neighbours (context) + every node the trace has
 *  touched so far (`active`). It GROWS as the investigation discovers nodes — the map reveals the graph
 *  as the trace walks it, rather than showing the whole estate up front. */
function visibleSlice(full: MapData, focusId: string, active: Set<string>): MapData {
  const byId = new Map<string, MapNode>(full.nodes.map((n) => [n.id, n]));
  const show = new Set<string>([focusId]);
  for (const e of full.edges) {
    if (e.from === focusId && byId.has(e.to)) show.add(e.to);
    if (e.to === focusId && byId.has(e.from)) show.add(e.from);
  }
  for (const id of active) if (byId.has(id)) show.add(id);
  const nodes: MapNode[] = [];
  for (const id of show) {
    const n = byId.get(id);
    if (n) nodes.push(n);
  }
  return {
    nodes,
    edges: full.edges.filter((e) => show.has(e.from) && show.has(e.to)),
    truncated: false,
  };
}

/** Kept for the empty-state check in the page (node + blast radius, undirected, `depth` hops). */
export function subgraphAround(map: MapData, focusId: string, depth = 2): MapData {
  const byId = new Map<string, MapNode>(map.nodes.map((n) => [n.id, n]));
  if (!byId.has(focusId)) return { nodes: [], edges: [], truncated: false };
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const l = adj.get(a);
    if (l) l.push(b);
    else adj.set(a, [b]);
  };
  for (const e of map.edges) {
    link(e.from, e.to);
    link(e.to, e.from);
  }
  const dist = new Map<string, number>([[focusId, 0]]);
  const queue: string[] = [focusId];
  for (let head = 0; head < queue.length; head += 1) {
    const cur = queue[head] as string;
    const d = dist.get(cur) ?? 0;
    if (d >= depth) continue;
    for (const nb of adj.get(cur) ?? []) {
      if (!dist.has(nb) && byId.has(nb)) {
        dist.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  const keep = new Set(dist.keys());
  const nodes: MapNode[] = [];
  for (const id of keep) {
    const n = byId.get(id);
    if (n) nodes.push(n);
  }
  return {
    nodes,
    edges: map.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    truncated: false,
  };
}

/**
 * War Room map (docs/plans/war-room.md). A PURPOSE-BUILT focused map — the broken node and the graph
 * the investigation walks, not the whole estate. As the trace streams, discovered nodes are REVEALED
 * and the connections it walks turn red (a live "hot path"); the evidence path — every connection
 * between cited nodes — stays red as the culprit chain, from the node through to the cause. Reuses the
 * real ResourceNode (icons + health) and the dagre layout.
 */
function WarRoomMapInner({
  full,
  focusId,
  activeIds,
  citedEdgeIds,
}: {
  full: MapData;
  focusId: string;
  activeIds: string[];
  citedEdgeIds: string[];
}) {
  const rf = useReactFlow();
  const active = React.useMemo(() => new Set(activeIds), [activeIds]);
  const citedEdges = React.useMemo(() => new Set(citedEdgeIds), [citedEdgeIds]);
  const slice = React.useMemo(() => visibleSlice(full, focusId, active), [full, focusId, active]);
  const base = React.useMemo(() => buildLayout(slice.nodes, slice.edges), [slice]);

  const nodes: Node[] = base.nodes.map((n) => {
    const isFocal = n.id === focusId;
    const isActive = active.has(n.id);
    return {
      ...n,
      selected: isFocal,
      ...(isActive && !isFocal ? { className: "wr-active-node" } : {}),
    };
  });

  // An edge is "hot" (red) when the model actually CITED it (the culprit connection), or when both its
  // endpoints have been touched (the walked evidence path). Animated so it reads as live during the
  // trace; a cited edge is drawn thicker as the pinpointed link.
  const edges: Edge[] = base.edges.map((e) => {
    const cited = citedEdges.has(e.id);
    const hot = cited || (active.has(e.source) && active.has(e.target));
    if (!hot) return e;
    return {
      ...e,
      animated: true,
      style: { ...(e.style ?? {}), stroke: HOT, strokeWidth: cited ? 3.5 : 2.5 },
    };
  });

  // Refit as nodes are revealed so the newly-discovered part comes into view.
  const key = nodes
    .map((n) => n.id)
    .sort()
    .join("|");
  React.useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.25, duration: 350 }), 60);
    return () => clearTimeout(t);
  }, [key, rf]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.2}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1.6}
        color="hsl(var(--muted-foreground) / 0.25)"
      />
      <style>{`
        .wr-active-node { border-radius: 0.6rem; box-shadow: 0 0 0 2px ${HOT}; animation: wrPulse 1.4s ease-in-out infinite; }
        @keyframes wrPulse { 0%,100% { box-shadow: 0 0 0 2px hsl(var(--danger) / 0.9); } 50% { box-shadow: 0 0 0 6px hsl(var(--danger) / 0.15); } }
      `}</style>
    </ReactFlow>
  );
}

export function WarRoomMap(props: {
  full: MapData;
  focusId: string;
  activeIds: string[];
  citedEdgeIds: string[];
}) {
  const has = props.full.nodes.some((n) => n.id === props.focusId);
  if (!has) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        This resource isn&apos;t on the map.
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <WarRoomMapInner {...props} />
    </ReactFlowProvider>
  );
}
