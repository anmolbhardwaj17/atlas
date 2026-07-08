"use client";

import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from "@xyflow/react";
import { CloudIcon, hasCloudIcon } from "@/components/cloud-icon";
import { kindIcon, kindStyle, KIND_LOGO } from "@/lib/kind-visual";
import { PROVIDER_META } from "@/lib/taxonomy";
import { cn } from "@/lib/cn";

function nodeLogo(kind: string): string | null {
  const svc = KIND_LOGO[kind];
  if (svc && hasCloudIcon(svc)) return svc;
  const brand = PROVIDER_META[kind.split(".")[0] ?? ""]?.logo;
  return brand && hasCloudIcon(brand) ? brand : null;
}

export interface GraphNodeData {
  label: string;
  kind: string;
  isCenter?: boolean;
  [key: string]: unknown;
}

/** A node in the neighborhood/impact graph: kind icon + name, the focal node inverted. */
function AtlasGraphNode({ data }: NodeProps) {
  const d = data as GraphNodeData;
  const logo = nodeLogo(d.kind);
  const Icon = kindIcon(d.kind);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm",
        d.isCenter
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-foreground",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-1 !border-0 !bg-transparent"
      />
      <span
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded",
          d.isCenter ? "bg-background/20" : logo ? "bg-muted/60" : kindStyle(d.kind),
        )}
      >
        {logo ? <CloudIcon name={logo} className="size-3.5" /> : <Icon className="size-3.5" />}
      </span>
      <span className="max-w-[150px] truncate font-medium">{d.label}</span>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-1 !border-0 !bg-transparent"
      />
    </div>
  );
}

const nodeTypes = { atlas: AtlasGraphNode };

/** Read-only React Flow canvas for a node's neighborhood / impact. Clicking a non-center node
 *  walks the graph to it. Layout (positions) is computed by the caller. */
export function NodeGraph({
  nodes,
  edges,
  height = 360,
}: {
  nodes: Node[];
  edges: Edge[];
  height?: number;
}) {
  const router = useRouter();
  const onNodeClick: NodeMouseHandler = (_e, node) => {
    const d = node.data as GraphNodeData;
    if (!d.isCenter) router.push(`/explore/${node.id}`);
  };
  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border bg-muted/20"
      style={{ height }}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.15}
        >
          <Background gap={16} size={1} className="opacity-40" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
