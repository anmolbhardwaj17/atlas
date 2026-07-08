"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { MarkerType, type Node, type Edge } from "@xyflow/react";
import { NodeGraph } from "./node-graph";
import { EdgeWhy } from "./edge-why";
import { ImpactPanel } from "./impact-panel";
import { Card, CardContent } from "@/components/ui/card";
import { ConfidenceBadge } from "@/components/certainty";
import { cn } from "@/lib/cn";
import type { EdgeDto, NodeDetail, TraversalResult } from "@/lib/graph-types";

type Tab = "connections" | "blast" | "deps";
const COLX = 240;
const ROW = 66;

const label = (n: { name: string | null; urn: string }) => n.name ?? n.urn;

/** One RF edge, styled by confidence (observed = solid, inferred = dashed) with its type as label. */
function rfEdge(
  id: string,
  source: string,
  target: string,
  type: string,
  confidence: string,
  marker: "start" | "end",
): Edge {
  const inferred = confidence !== "observed";
  const arrow = {
    type: MarkerType.ArrowClosed,
    width: 14,
    height: 14,
    color: "hsl(var(--muted-foreground))",
  };
  return {
    id,
    source,
    target,
    label: type,
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 3,
    labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
    labelBgStyle: { fill: "hsl(var(--background))" },
    style: {
      strokeWidth: 1.5,
      stroke: "hsl(var(--muted-foreground) / 0.6)",
      ...(inferred ? { strokeDasharray: "5 4" } : {}),
    },
    ...(marker === "end" ? { markerEnd: arrow } : { markerStart: arrow }),
  };
}

/** 1-hop neighborhood: focal node centered, outgoing to the right, incoming to the left. */
function connectionsModel(node: NodeDetail, edges: EdgeDto[]): { nodes: Node[]; edges: Edge[] } {
  const outgoing = edges.filter((e) => e.from.id === node.id);
  const incoming = edges.filter((e) => e.to.id === node.id);
  const rows = Math.max(outgoing.length, incoming.length, 1);
  const centerY = ((rows - 1) * ROW) / 2;
  const nodes: Node[] = [
    {
      id: node.id,
      type: "atlas",
      position: { x: COLX, y: centerY },
      data: { label: label(node), kind: node.kind, isCenter: true },
    },
  ];
  const seen = new Set([node.id]);
  const rfEdges: Edge[] = [];
  outgoing.forEach((e, i) => {
    const y = (i - (outgoing.length - 1) / 2) * ROW + centerY;
    if (!seen.has(e.to.id)) {
      seen.add(e.to.id);
      nodes.push({
        id: e.to.id,
        type: "atlas",
        position: { x: COLX * 2, y },
        data: { label: label(e.to), kind: e.to.kind },
      });
    }
    rfEdges.push(rfEdge(e.id, node.id, e.to.id, e.type, e.confidence, "end"));
  });
  incoming.forEach((e, i) => {
    const y = (i - (incoming.length - 1) / 2) * ROW + centerY;
    if (!seen.has(e.from.id)) {
      seen.add(e.from.id);
      nodes.push({
        id: e.from.id,
        type: "atlas",
        position: { x: 0, y },
        data: { label: label(e.from), kind: e.from.kind },
      });
    }
    rfEdges.push(rfEdge(e.id, e.from.id, node.id, e.type, e.confidence, "end"));
  });
  return { nodes, edges: rfEdges };
}

/** Traversal graph: root on the left, impacted nodes in columns by hop distance, real parent edges.
 *  `dir` sets the arrow direction — deps flow outward (→), blast points back toward the root (←). */
function traversalModel(
  result: TraversalResult,
  dir: "blast" | "deps",
): { nodes: Node[]; edges: Edge[] } {
  const byDist = new Map<number, TraversalResult["impacted"]>();
  for (const it of result.impacted) {
    const b = byDist.get(it.distance) ?? [];
    b.push(it);
    byDist.set(it.distance, b);
  }
  const nodes: Node[] = [
    {
      id: result.root.id,
      type: "atlas",
      position: { x: 0, y: 0 },
      data: { label: label(result.root), kind: result.root.kind, isCenter: true },
    },
  ];
  const rfEdges: Edge[] = [];
  for (const [d, items] of byDist) {
    items.forEach((it, i) => {
      const y = (i - (items.length - 1) / 2) * ROW;
      nodes.push({
        id: it.node.id,
        type: "atlas",
        position: { x: d * COLX, y },
        data: { label: label(it.node), kind: it.node.kind },
      });
      const last = it.via[it.via.length - 1];
      // Geometric edge is always parent(left)→child(right); the arrow end conveys real direction.
      rfEdges.push(
        rfEdge(
          `${it.parentId}->${it.node.id}`,
          it.parentId,
          it.node.id,
          last?.type ?? "",
          last?.confidence ?? it.pathConfidence,
          dir === "deps" ? "end" : "start",
        ),
      );
    });
  }
  return { nodes, edges: rfEdges };
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The unified connections + impact surface for a node. One interactive graph with tabs:
 * Connections (1-hop neighborhood), Blast radius (what breaks downstream), Depends on (what it
 * needs) — folding the old separate impact page in. Each tab keeps an accessible list beneath the
 * graph, and every edge's "why?" expands inline (provenance) instead of opening a new page.
 */
export function NodeConnections({
  orgId,
  node,
  edges,
  blast,
  deps,
}: {
  orgId: string;
  node: NodeDetail;
  edges: EdgeDto[];
  blast: TraversalResult | null;
  deps: TraversalResult | null;
}) {
  const [tab, setTab] = React.useState<Tab>("connections");
  const hasBlast = (blast?.impacted.length ?? 0) > 0;
  const hasDeps = (deps?.impacted.length ?? 0) > 0;

  const model = React.useMemo(() => {
    if (tab === "blast" && blast) return traversalModel(blast, "blast");
    if (tab === "deps" && deps) return traversalModel(deps, "deps");
    return connectionsModel(node, edges);
  }, [tab, node, edges, blast, deps]);

  const outgoing = edges.filter((e) => e.from.id === node.id);
  const incoming = edges.filter((e) => e.to.id === node.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-border">
        <TabBtn active={tab === "connections"} onClick={() => setTab("connections")}>
          Connections <span className="text-muted-foreground">{edges.length}</span>
        </TabBtn>
        {hasBlast ? (
          <TabBtn active={tab === "blast"} onClick={() => setTab("blast")}>
            Blast radius <span className="text-muted-foreground">{blast?.impacted.length}</span>
          </TabBtn>
        ) : null}
        {hasDeps ? (
          <TabBtn active={tab === "deps"} onClick={() => setTab("deps")}>
            Depends on <span className="text-muted-foreground">{deps?.impacted.length}</span>
          </TabBtn>
        ) : null}
      </div>

      {edges.length === 0 && !hasBlast && !hasDeps ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No connections — nothing points at this resource and it points at nothing (yet).
          </CardContent>
        </Card>
      ) : (
        <>
          <NodeGraph nodes={model.nodes} edges={model.edges} danger={tab === "blast"} />

          {/* Accessible list beneath the graph (a11y + inline provenance). */}
          {tab === "connections" ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <EdgeList
                  orgId={orgId}
                  title="Depends on / points to"
                  icon={<ArrowUpRight className="size-3.5" />}
                  edges={outgoing}
                  endpoint={(e) => e.to}
                  emptyText="No outgoing edges."
                />
                <EdgeList
                  orgId={orgId}
                  title="Depended on by / pointed to from"
                  icon={<ArrowDownLeft className="size-3.5" />}
                  edges={incoming}
                  endpoint={(e) => e.from}
                  emptyText="No incoming edges."
                />
              </CardContent>
            </Card>
          ) : tab === "blast" ? (
            <ImpactPanel
              title="Blast radius"
              subtitle="What breaks downstream if this resource fails or changes."
              result={blast}
            />
          ) : (
            <ImpactPanel
              title="Depends on"
              subtitle="What this resource needs to work — its upstream dependencies."
              result={deps}
            />
          )}
        </>
      )}
    </div>
  );
}

function EdgeList({
  orgId,
  title,
  icon,
  edges,
  endpoint,
  emptyText,
}: {
  orgId: string;
  title: string;
  icon: React.ReactNode;
  edges: EdgeDto[];
  endpoint: (e: EdgeDto) => EdgeDto["from"];
  emptyText: string;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </p>
      {edges.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border">
          {edges.map((e) => {
            const other = endpoint(e);
            return (
              <li key={e.id} className="py-2.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                      {e.type}
                    </span>
                    <Link href={`/explore/${other.id}`} className="truncate hover:text-primary">
                      {other.name ?? other.urn}
                    </Link>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <ConfidenceBadge tier={e.confidence} evidence={`origin: ${e.origin}`} />
                    <EdgeWhy orgId={orgId} edgeId={e.id} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
