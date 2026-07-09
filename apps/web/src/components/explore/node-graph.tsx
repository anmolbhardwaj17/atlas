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
  /** Focal node of a blast-radius view → emit radar pulse rings. */
  pulse?: boolean;
  /** How far (px, in flow coords) the pulse must travel to reach the farthest impacted node. */
  pulseRadius?: number;
  [key: string]: unknown;
}

/** A node in the neighborhood/impact graph: kind icon + name, the focal node inverted. When it's
 *  the blast-radius focal node, radar rings pulse outward from behind it toward the impacted nodes. */
function AtlasGraphNode({ data }: NodeProps) {
  const d = data as GraphNodeData;
  const logo = nodeLogo(d.kind);
  const Icon = kindIcon(d.kind);
  return (
    <div className="relative">
      {d.isCenter && d.pulse
        ? [0, 1, 2].map((i) => {
            const size = (d.pulseRadius ?? 220) * 2;
            return (
              <span
                key={i}
                aria-hidden
                className="animate-blast-pulse pointer-events-none absolute left-1/2 top-1/2 rounded-full bg-danger/15"
                style={{ width: size, height: size, animationDelay: `${i * 0.85}s` }}
              />
            );
          })
        : null}
      <div
        className={cn(
          "relative flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs shadow-sm",
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
  danger = false,
}: {
  nodes: Node[];
  edges: Edge[];
  height?: number;
  danger?: boolean;
}) {
  const router = useRouter();
  const onNodeClick: NodeMouseHandler = (_e, node) => {
    const d = node.data as GraphNodeData;
    if (!d.isCenter) router.push(`/explore/${node.id}`);
  };
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border bg-muted/20",
        danger ? "border-danger/30" : "border-border",
      )}
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
