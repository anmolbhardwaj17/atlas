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
import { X, Info } from "lucide-react";
import { buildLayout } from "@/lib/map-layout";
import {
  ENV_LABEL,
  edgeCrossing,
  groupingFor,
  chipVisual,
  CROSS_COLOR,
  type ChipVisual,
  type GroupMode,
  type Grouping,
  type MapData,
  type MapNode,
} from "@/lib/map-types";
import { ResourceNode, EnvLaneNode } from "@/components/map/resource-node";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { cn } from "@/lib/cn";

const nodeTypes = { resource: ResourceNode, envLane: EnvLaneNode };

/**
 * Interactive infrastructure map (docs/09 §5.4). Resources as nodes, connections as edges,
 * framed into environment lanes (prod / staging / … / code). Read-first: pan, zoom, filter
 * by environment, click a resource to inspect it and jump to its detail / blast-radius.
 * Certainty is legible per node (solid = observed, faded/ring = inferred) and per edge
 * (solid = observed, dashed = inferred) — P3/P4, mono theme.
 */
const GROUP_MODES: { mode: GroupMode; label: string }[] = [
  { mode: "environment", label: "Environment" },
  { mode: "cloud", label: "Cloud" },
  { mode: "account", label: "Account" },
];

/** One-line explainer of what the lanes mean in the current grouping — updates on selection. */
const GROUP_HELP: Record<GroupMode, string> = {
  environment:
    "Lanes are environments — where each resource runs (Production, Staging, or shared code).",
  cloud:
    "Lanes are cloud providers — who runs each resource (AWS, Azure, GCP) plus your code hosts.",
  account:
    "Lanes are accounts — the billing & isolation boundary each resource lives in (an AWS account, Azure subscription, or GCP project).",
};

export function InfraMap({ data }: { data: MapData }) {
  const [groupMode, setGroupMode] = useState<GroupMode>("environment");
  const grouping = useMemo(() => groupingFor(groupMode), [groupMode]);

  // The present lane keys for the current grouping, in lane order.
  const present = useMemo(
    () => grouping.order([...new Set(data.nodes.map((n) => grouping.keyOf(n)))]),
    [data.nodes, grouping],
  );

  const [active, setActive] = useState<Set<string>>(() => new Set(present));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (data.nodes.find((n) => n.id === selectedId) ?? null) : null;

  // How many connections cross a cloud / account boundary — the enterprise headline.
  const cross = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    let crossCloud = 0;
    let crossAccount = 0;
    for (const e of data.edges) {
      const x = edgeCrossing(byId.get(e.from), byId.get(e.to));
      if (x.crossCloud) crossCloud += 1;
      if (x.crossAccount) crossAccount += 1;
    }
    return { crossCloud, crossAccount };
  }, [data]);

  // Reset the lane filter to "all present" whenever the grouping dimension changes.
  useEffect(() => setActive(new Set(present)), [present]);

  function toggleKey(key: string) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next.size === 0 ? new Set(present) : next; // never show nothing
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Infrastructure map</h1>
          <p className="text-sm text-muted-foreground">
            Your estate as one graph — across accounts and clouds. Group it, then click a resource
            to inspect it.
          </p>
        </div>
        {/* Group-by segmented control. */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          {GROUP_MODES.map((g) => (
            <button
              key={g.mode}
              type="button"
              onClick={() => setGroupMode(g.mode)}
              aria-pressed={groupMode === g.mode}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                groupMode === g.mode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contextual explainer — what the lanes mean in the current grouping. */}
      <p className="flex items-center gap-1.5 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        {GROUP_HELP[groupMode]}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {present.map((key) => (
          <GroupChip
            key={key}
            mode={groupMode}
            label={grouping.labelOf(key)}
            visual={chipVisual(groupMode, key)}
            active={active.has(key)}
            onToggle={() => toggleKey(key)}
          />
        ))}
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {cross.crossCloud + cross.crossAccount > 0 && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 font-medium"
              style={{ color: CROSS_COLOR, backgroundColor: `${CROSS_COLOR}1F` }}
              title="Connections that span a cloud or account boundary"
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: CROSS_COLOR }} />
              {cross.crossCloud > 0 && `${cross.crossCloud} cross-cloud`}
              {cross.crossCloud > 0 && cross.crossAccount > 0 && " · "}
              {cross.crossAccount > 0 && `${cross.crossAccount} cross-account`}
            </span>
          )}
          <Legend />
        </span>
      </div>

      {data.truncated && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Showing the most recent {data.nodes.length} resources — the graph is larger. Filter to
          focus.
        </p>
      )}

      <div className="relative h-[calc(100dvh-14rem)] min-h-[480px] overflow-hidden rounded-xl border border-border bg-background">
        <ReactFlowProvider>
          <Flow data={data} active={active} grouping={grouping} onSelect={setSelectedId} />
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
  grouping,
  onSelect,
}: {
  data: MapData;
  active: Set<string>;
  grouping: Grouping;
  onSelect: (id: string | null) => void;
}) {
  const layout = useMemo(() => {
    const visibleNodes = data.nodes.filter((n) => active.has(grouping.keyOf(n)));
    const ids = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = data.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    return buildLayout(visibleNodes, visibleEdges, grouping);
  }, [data, active, grouping]);

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

/**
 * A group-by filter chip. Environments carry a semantic hue + dot; clouds carry their brand
 * hue + real logo; accounts stay neutral. Selected = category-coloured fill, off = muted
 * outline (with the category cue still visible so the palette reads even when filtered out).
 */
function GroupChip({
  mode,
  label,
  visual,
  active,
  onToggle,
}: {
  mode: GroupMode;
  label: string;
  visual: ChipVisual;
  active: boolean;
  onToggle: () => void;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors";
  const off = "border-border text-muted-foreground hover:border-foreground/40";
  const FallbackIcon = visual.fallbackIcon;

  // Cloud lanes: brand hue + real logo, driven inline (brand colours aren't theme tokens).
  if (mode === "cloud" && visual.brand) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={cn(base, active ? "border-transparent" : off)}
        style={active ? { color: visual.brand, backgroundColor: `${visual.brand}1F` } : undefined}
      >
        {visual.logo && hasCloudIcon(visual.logo) ? (
          <CloudIcon name={visual.logo} className="size-3.5" />
        ) : FallbackIcon ? (
          <FallbackIcon className="size-3.5" />
        ) : null}
        {label}
      </button>
    );
  }

  // Environment lanes: semantic hue class + always-visible dot.
  if (mode === "environment") {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={active}
        className={cn(base, active ? visual.activeClass : off)}
      >
        {visual.dot && <span className={cn("size-1.5 rounded-full", visual.dot)} />}
        {label}
      </button>
    );
  }

  // Account (neutral): the original mono treatment.
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(base, active ? "border-foreground bg-foreground text-background" : off)}
    >
      {label}
    </button>
  );
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
      <span className="flex items-center gap-1">
        <span className="h-0.5 w-4 rounded" style={{ backgroundColor: CROSS_COLOR }} />{" "}
        cross-boundary
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
