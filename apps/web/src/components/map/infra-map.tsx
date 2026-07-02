"use client";

import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import { X } from "lucide-react";
import { buildLayout } from "@/lib/map-layout";
import { ENV_ORDER, ENV_LABEL, type MapData, type MapNode } from "@/lib/map-types";
import { ResourceNode, EnvLaneNode } from "@/components/map/resource-node";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { cn } from "@/lib/cn";

const nodeTypes = { resource: ResourceNode, envLane: EnvLaneNode };

/**
 * Interactive infrastructure map (docs/09 §5.4). Resources as nodes, connections as edges,
 * framed into environment lanes (prod / staging / … / code). Read-first: pan, zoom, filter
 * by environment, click a resource to inspect it and jump to its detail / blast-radius.
 * Certainty is legible per node (solid = observed, faded/ring = inferred) and per edge
 * (solid = observed, dashed = inferred) — P3/P4, mono theme.
 */
export function InfraMap({ data }: { data: MapData }) {
  const present = useMemo(() => {
    const set = new Set(data.nodes.map((n) => (isEnv(n.environment) ? n.environment : "unknown")));
    return ENV_ORDER.filter((e) => set.has(e));
  }, [data.nodes]);

  const [active, setActive] = useState<Set<string>>(() => new Set(present));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (data.nodes.find((n) => n.id === selectedId) ?? null) : null;

  function toggleEnv(env: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(env)) next.delete(env);
      else next.add(env);
      return next.size === 0 ? new Set(present) : next; // never show nothing
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Infrastructure map</h1>
        <p className="text-sm text-muted-foreground">
          Your estate as a graph — resources, how they connect, grouped by environment. Click a
          resource to inspect it.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {present.map((env) => (
          <button
            key={env}
            type="button"
            onClick={() => toggleEnv(env)}
            aria-pressed={active.has(env)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active.has(env)
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40",
            )}
          >
            {ENV_LABEL[env] ?? env}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <Legend />
        </span>
      </div>

      {data.truncated && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Showing the most recent {data.nodes.length} resources — the graph is larger. Filter by
          environment to focus.
        </p>
      )}

      <div className="relative h-[calc(100dvh-14rem)] min-h-[480px] overflow-hidden rounded-xl border border-border bg-background">
        <ReactFlowProvider>
          <Flow data={data} active={active} onSelect={setSelectedId} />
        </ReactFlowProvider>
        {selected && <DetailPanel node={selected} onClose={() => setSelectedId(null)} />}
      </div>
    </div>
  );
}

/**
 * The canvas itself. Nodes/edges are driven through `useNodesState`/`useEdgesState` so React
 * Flow receives dimension measurements (required in v12 — a static `nodes` prop leaves nodes
 * `visibility:hidden` and never fits). We re-layout + re-fit whenever the data or the env
 * filter changes.
 */
function Flow({
  data,
  active,
  onSelect,
}: {
  data: MapData;
  active: Set<string>;
  onSelect: (id: string | null) => void;
}) {
  const layout = useMemo(() => {
    const visibleNodes = data.nodes.filter((n) =>
      active.has(isEnv(n.environment) ? n.environment : "unknown"),
    );
    const ids = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = data.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    return buildLayout(visibleNodes, visibleEdges);
  }, [data, active]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    setNodes(layout.nodes);
    setEdges(layout.edges);
    // Fit after the new nodes are in the store + painted (filter changes re-fit too).
    const t = setTimeout(() => void fitView({ padding: 0.15, duration: 300 }), 160);
    return () => clearTimeout(t);
  }, [layout, setNodes, setEdges, fitView]);

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    onSelect(node.type === "resource" ? node.id : null);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelect(null)}
      onInit={(inst) => void inst.fitView({ padding: 0.15 })}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      fitView
      minZoom={0.1}
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={20} color="hsl(var(--border))" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor="hsl(var(--muted-foreground))" />
    </ReactFlow>
  );
}

function isEnv(e: string): e is (typeof ENV_ORDER)[number] {
  return (ENV_ORDER as readonly string[]).includes(e);
}

function Legend() {
  return (
    <>
      <span className="flex items-center gap-1">
        <span className="h-px w-4 bg-foreground" /> observed
      </span>
      <span className="flex items-center gap-1">
        <span className="h-px w-4 border-t border-dashed border-muted-foreground" /> inferred
      </span>
    </>
  );
}

function DetailPanel({ node, onClose }: { node: MapNode; onClose: () => void }) {
  const kindShort = node.kind.replace(/^aws\.|^github\.|^external\.|^atlas\./, "");
  return (
    <div className="absolute right-3 top-3 z-10 w-72 rounded-lg border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{node.name ?? kindShort}</div>
          <div className="text-xs text-muted-foreground">{node.kind}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <dl className="mt-3 space-y-1.5 text-xs">
        <Row label="Environment" value={ENV_LABEL[node.environment] ?? node.environment} />
        {node.region ? <Row label="Region" value={node.region} /> : null}
        {node.accountRef ? <Row label="Account" value={node.accountRef} /> : null}
      </dl>
      <div className="mt-3 flex items-center gap-2">
        <ConfidenceBadge tier={node.confidence} />
        <FreshnessTag status={node.status} />
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href={`/explore/${node.id}`}
          className="inline-flex h-8 flex-1 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Details
        </Link>
        <Link
          href={`/explore/${node.id}/impact`}
          className="inline-flex h-8 flex-1 items-center justify-center rounded-md border border-border px-3 text-xs font-medium hover:border-foreground/40"
        >
          Impact
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
