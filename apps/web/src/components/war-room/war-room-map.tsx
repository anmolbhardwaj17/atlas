"use client";

import "@xyflow/react/dist/style.css";
import * as React from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  type Node,
} from "@xyflow/react";
import { buildLayout } from "@/lib/map-layout";
import { ResourceNode, EnvLaneNode } from "@/components/map/resource-node";
import type { MapData, MapNode } from "@/lib/map-types";

const nodeTypes = { resource: ResourceNode, envLane: EnvLaneNode };

/** The node + its blast radius (nodes within `depth` hops over any edge). Focused, not the estate. */
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
 * War Room map (docs/plans/war-room.md). A PURPOSE-BUILT focused map — just the broken node and its
 * blast radius, not the whole estate (no toolbar/shelves/chat chrome). As the investigation streams,
 * the nodes it touches (`activeIds`) light up live, so you watch the trace walk the graph; everything
 * else recedes. Reuses the real ResourceNode (icons + health rings) and the dagre layout.
 */
function WarRoomMapInner({
  data,
  focusId,
  activeIds,
}: {
  data: MapData;
  focusId: string;
  activeIds: string[];
}) {
  const active = React.useMemo(() => new Set(activeIds), [activeIds]);
  const base = React.useMemo(() => buildLayout(data.nodes, data.edges), [data]);

  const nodes: Node[] = base.nodes.map((n) => {
    const isFocal = n.id === focusId;
    const isActive = active.has(n.id);
    const spotlight = active.size > 0;
    return {
      ...n,
      selected: isFocal,
      // A pulsing ring on the node the trace is currently touching.
      ...(isActive && !isFocal ? { className: "wr-active-node" } : {}),
      data: { ...(n.data as object), dim: spotlight && !isFocal && !isActive },
    };
  });

  return (
    <ReactFlow
      nodes={nodes}
      edges={base.edges}
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
      {/* Live-trace pulse for the node under investigation. */}
      <style>{`
        .wr-active-node { border-radius: 0.6rem; box-shadow: 0 0 0 2px hsl(var(--foreground)); animation: wrPulse 1.4s ease-in-out infinite; }
        @keyframes wrPulse { 0%,100% { box-shadow: 0 0 0 2px hsl(var(--foreground) / 0.9); } 50% { box-shadow: 0 0 0 5px hsl(var(--foreground) / 0.15); } }
      `}</style>
    </ReactFlow>
  );
}

export function WarRoomMap(props: { data: MapData; focusId: string; activeIds: string[] }) {
  if (props.data.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No connected resources to map.
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <WarRoomMapInner {...props} />
    </ReactFlowProvider>
  );
}
