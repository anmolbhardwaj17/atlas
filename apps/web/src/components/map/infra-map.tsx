"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import { Clock, ListFilter, Search, Shield, Stethoscope, X } from "lucide-react";
import { buildLayout } from "@/lib/map-layout";
import { kindShort } from "@/lib/kind-visual";
import { edgeCrossing, CROSS_COLOR, type MapData, type MapNode } from "@/lib/map-types";
import { ResourceNode, EnvLaneNode } from "@/components/map/resource-node";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { cn } from "@/lib/cn";

const nodeTypes = { resource: ResourceNode, envLane: EnvLaneNode };

/**
 * Interactive infrastructure map (docs/09 §5.4). Resources as nodes, connections as edges,
 * laid out as ONE left-to-right architecture flow (entry points → compute → data). Read-first:
 * pan, zoom, click a resource to inspect it and jump to its detail / blast-radius. Certainty
 * is legible per node (solid = observed, faded/ring = inferred) and per edge (solid =
 * observed, dashed = inferred) - P3/P4, mono theme. Environment/cloud/account lane grouping
 * is disabled for now (single-env estates) - revisit when a customer needs it.
 */
// Activity + containers that were never the point of an INFRA map (browsable in Explore).
// Repositories are kept: the ones that deploy join the flow, the rest go to a code shelf.
const NON_MAP_KIND = /\.(project|pipeline|workflow|user|team|pullrequest|pull_request)$/;

export function InfraMap({ data: rawData }: { data: MapData }) {
  // Drop only the granular code activity (projects/pipelines/PRs/users) - a project fanning
  // out to its PRs is what buried the flow. EVERY repository stays: a repo that deploys joins
  // the infra flow beside its compute; a repo with no infra link lands in a compact code
  // shelf below (buildLayout), so you still see all your repos AND which ones aren't yet
  // linked to infrastructure - the "missing connection" signal is the point, not hidden.
  const data = useMemo(() => {
    const nodes = rawData.nodes.filter((n) => !NON_MAP_KIND.test(n.kind));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = rawData.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
    return { ...rawData, nodes, edges };
  }, [rawData]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (data.nodes.find((n) => n.id === selectedId) ?? null) : null;
  // Security overlay: OFF = the clean traffic flow (protection as shield chips only);
  // ON = security groups return to the canvas with their PROTECTS edges drawn, for the
  // boundary-audit view. Default off - flow first, boundaries on demand.
  const [showSecurity, setShowSecurity] = useState(false);

  // Health lens (operational-intelligence north star): OFF = normal map; ON = recolour the whole
  // graph by runtime health — broken/degraded nodes stay lit, everything healthy recedes, so
  // "what's on fire" reads in one glance. Default off.
  const [healthLens, setHealthLens] = useState(false);

  // "What changed" lens: highlight recently-observed (new) or drifted (stale/deleted) nodes; the
  // rest recede. Answers "what moved lately" at a glance.
  const [changedLens, setChangedLens] = useState(false);

  // Kind filter: pick one or more resource kinds to focus (empty = show everything). Non-matching
  // nodes recede, same as the Health lens. The chip list is the kinds actually present.
  const [showFilters, setShowFilters] = useState(false);
  const [kindFilter, setKindFilter] = useState<Set<string>>(new Set());
  const kinds = useMemo(
    () => [...new Set(data.nodes.map((n) => n.kind))].sort((a, b) => a.localeCompare(b)),
    [data.nodes],
  );
  const toggleKind = useCallback(
    (k: string) =>
      setKindFilter((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k);
        else next.add(k);
        return next;
      }),
    [],
  );

  // Protection is a PROPERTY, not a flow: a security group fanning out to five resources
  // drew the longest, noisiest rails on the canvas. By default PROTECTS edges become a
  // shield chip on the protected node (full list in its detail panel); an SG whose only
  // edges were PROTECTS then drops off the map automatically (still in Explore). The
  // Security toggle brings both back.
  const canvasEdges = useMemo(
    () => (showSecurity ? data.edges : data.edges.filter((e) => e.type !== "PROTECTS")),
    [data.edges, showSecurity],
  );
  const protectedBy = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const m = new Map<string, string[]>();
    for (const e of data.edges) {
      if (e.type !== "PROTECTS") continue;
      const sg = byId.get(e.from);
      if (!sg) continue;
      const arr = m.get(e.to) ?? [];
      arr.push(shortName(sg));
      m.set(e.to, arr);
    }
    return m;
  }, [data]);

  // Containment hierarchy for drill-down collapse: a node "contains" the nodes it points to
  // via structural edges (project→repo→pipeline/PR; PR→author). `connectedIds` = nodes with
  // any canvas edge - so isolated nodes are dropped from the map entirely.
  const { childrenOf, connectedIds } = useMemo(() => {
    const children = new Map<string, string[]>();
    const connected = new Set<string>();
    for (const e of canvasEdges) {
      connected.add(e.from);
      connected.add(e.to);
      if (e.type === "CONTAINS" || e.type === "OWNED_BY") {
        const arr = children.get(e.from);
        if (arr) arr.push(e.to);
        else children.set(e.from, [e.to]);
      }
    }
    return { childrenOf: children, connectedIds: connected };
  }, [canvasEdges]);

  // Default = collapsed to top-level containers. Until the user toggles, the effective set is
  // "all containers folded" - computed during render so the FIRST paint is already collapsed
  // (no 130-node → 27-node flash that made fitView zoom to nothing).
  const userToggled = useRef(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    userToggled.current = false;
    setCollapsed(new Set());
  }, [data.edges]);
  const effectiveCollapsed = useMemo(
    () => (userToggled.current ? collapsed : new Set(childrenOf.keys())),
    [collapsed, childrenOf],
  );
  const toggleCollapse = useCallback(
    (id: string) =>
      setCollapsed((prev) => {
        const base = userToggled.current ? prev : new Set(childrenOf.keys());
        userToggled.current = true;
        const next = new Set(base);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [childrenOf],
  );

  // How many connections cross a cloud / account boundary - the enterprise headline.
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start gap-3">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Infrastructure map</h1>
          <p className="text-sm text-muted-foreground">
            Your infrastructure and code, wired together — follow it left to right, from entry
            points through compute into your data stores.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => setShowSecurity((v) => !v)}
            aria-pressed={showSecurity}
            title={
              showSecurity
                ? "Hide security groups and protection edges"
                : "Show security groups and what they protect"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-colors",
              showSecurity
                ? "border-transparent bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <Shield className="size-3.5" />
            Security
          </button>
          <button
            type="button"
            onClick={() => setHealthLens((v) => !v)}
            aria-pressed={healthLens}
            title={
              healthLens
                ? "Back to the normal map"
                : "Highlight unhealthy resources — dim everything that's healthy"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-colors",
              healthLens
                ? "border-transparent bg-danger text-white"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <Stethoscope className="size-3.5" />
            Health
          </button>
          <button
            type="button"
            onClick={() => setChangedLens((v) => !v)}
            aria-pressed={changedLens}
            title={
              changedLens
                ? "Back to the normal map"
                : "Highlight recently added or drifted resources"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-colors",
              changedLens
                ? "border-transparent bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <Clock className="size-3.5" />
            Changed
          </button>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-pressed={showFilters || kindFilter.size > 0}
            title="Filter the map by resource kind"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium transition-colors",
              showFilters || kindFilter.size > 0
                ? "border-transparent bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            <ListFilter className="size-3.5" />
            Filter
            {kindFilter.size > 0 ? (
              <span className="rounded-full bg-background/20 px-1 text-[10px] tabular-nums">
                {kindFilter.size}
              </span>
            ) : null}
          </button>
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
        </span>
        {showFilters ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {kinds.map((k) => {
              const on = kindFilter.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleKind(k)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                    on
                      ? "border-transparent bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                  )}
                >
                  {kindShort(k)}
                </button>
              );
            })}
            {kindFilter.size > 0 ? (
              <button
                type="button"
                onClick={() => setKindFilter(new Set())}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" /> Clear
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {data.truncated && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Showing the most recent {data.nodes.length} resources - the graph is larger. Filter to
          focus.
        </p>
      )}

      <div className="relative h-[calc(100dvh-14rem)] min-h-[480px] overflow-hidden rounded-xl border border-border bg-background">
        <ReactFlowProvider>
          <Flow
            data={data}
            canvasEdges={canvasEdges}
            protectedBy={protectedBy}
            selectedId={selectedId}
            onSelect={setSelectedId}
            childrenOf={childrenOf}
            connectedIds={connectedIds}
            collapsed={effectiveCollapsed}
            onToggleCollapse={toggleCollapse}
            showSecurity={showSecurity}
            healthLens={healthLens}
            changedLens={changedLens}
            kindFilter={kindFilter}
          />
        </ReactFlowProvider>
        {!selected && <Legend />}
        {selected && (
          <DetailPanel
            node={selected}
            data={data}
            protectedBy={protectedBy.get(selected.id) ?? []}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The canvas itself. Nodes/edges are driven through `useNodesState`/`useEdgesState` so React
 * Flow receives dimension measurements (required in v12 - a static `nodes` prop leaves nodes
 * `visibility:hidden` and never fits). We re-layout + re-fit whenever the data or the env
 * filter changes.
 */
/** Edge decoration for hover/selection: the active node's edges light up and reveal their
 *  label; everything else fades so the traced path is the only story on screen. */
function decorateEdges(edges: Edge[], activeId: string | null, litSet: Set<string> | null): Edge[] {
  if (!activeId && !litSet) return edges;
  return edges.map((e) => {
    const touches = !!activeId && (e.source === activeId || e.target === activeId);
    // An edge stays lit only when BOTH endpoints are lit; otherwise it recedes with them.
    const inScope = litSet ? litSet.has(e.source) && litSet.has(e.target) : true;
    return {
      ...e,
      label: touches ? ((e.data as { label?: string } | undefined)?.label ?? "") : undefined,
      labelShowBg: true,
      zIndex: touches ? 7 : inScope ? 3 : (e.zIndex ?? 1),
      style: {
        ...e.style,
        opacity: !inScope ? 0.08 : touches ? 1 : 0.9,
        strokeWidth: touches ? 2.25 : (e.style?.strokeWidth ?? 1.5),
      },
    };
  });
}

function Flow({
  data,
  canvasEdges,
  protectedBy,
  selectedId,
  onSelect,
  childrenOf,
  connectedIds,
  collapsed,
  onToggleCollapse,
  showSecurity,
  healthLens,
  changedLens,
  kindFilter,
}: {
  data: MapData;
  canvasEdges: MapData["edges"];
  protectedBy: Map<string, string[]>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  childrenOf: Map<string, string[]>;
  connectedIds: Set<string>;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  showSecurity: boolean;
  healthLens: boolean;
  changedLens: boolean;
  kindFilter: Set<string>;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeId = hoveredId ?? selectedId;
  // "Ask the map": a query highlights every matching node (null = no query). While a query is
  // active the shelves auto-expand so matches hiding in them aren't missed.
  const [queryIds, setQueryIds] = useState<Set<string> | null>(null);
  // The unlinked "shelves" collapse to a single labelled banner. Both start collapsed — a wall of
  // unlinked repos/resources is noise by default; expand a banner to browse (or use search).
  const [collapsedShelves, setCollapsedShelves] = useState<Set<string>>(
    new Set(["shelf-code", "shelf-unconnected"]),
  );
  const toggleShelf = useCallback(
    (id: string) =>
      setCollapsedShelves((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  // Descendants of any collapsed node are hidden (BFS down the containment tree, cycle-safe).
  const hiddenSet = useMemo(() => {
    const hidden = new Set<string>();
    for (const cid of collapsed) {
      const stack = [...(childrenOf.get(cid) ?? [])];
      while (stack.length > 0) {
        const x = stack.pop();
        if (!x || hidden.has(x)) continue;
        hidden.add(x);
        for (const c of childrenOf.get(x) ?? []) stack.push(c);
      }
    }
    return hidden;
  }, [collapsed, childrenOf]);

  // Open PRs contained per repo, for the "N open PR" badge. The map already filters to open PRs
  // server-side, so any CONTAINS child that's a PR node is open.
  const openPrByRepo = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const counts = new Map<string, number>();
    for (const e of data.edges) {
      if (e.type !== "CONTAINS") continue;
      const child = byId.get(e.to);
      if (child && child.kind.endsWith(".pullrequest")) {
        counts.set(e.from, (counts.get(e.from) ?? 0) + 1);
      }
    }
    return counts;
  }, [data]);

  const layout = useMemo(() => {
    const visibleNodes = data.nodes.filter((n) => !hiddenSet.has(n.id));
    const ids = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = canvasEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
    // A query expands the shelves so matches inside them render and can be highlighted.
    const shelvesForLayout = queryIds ? new Set<string>() : collapsedShelves;
    const l = buildLayout(visibleNodes, visibleEdges, shelvesForLayout);
    // Attach collapse state (drives the ⊕/⊖ toggle), an open-PR count, and the shield chip
    // (who protects this node) so protection reads on the card, not as canvas rails.
    l.nodes = l.nodes.map((nd) => {
      // Shelf banners get their expand/collapse handler wired in here.
      if (nd.type === "envLane") {
        return { ...nd, data: { ...nd.data, onToggle: () => toggleShelf(nd.id) } };
      }
      if (nd.type !== "resource") return nd;
      const kids = childrenOf.get(nd.id);
      const openPrCount = openPrByRepo.get(nd.id) ?? 0;
      const protectors = protectedBy.get(nd.id);
      if ((!kids || kids.length === 0) && openPrCount === 0 && !protectors) return nd;
      return {
        ...nd,
        data: {
          ...nd.data,
          openPrCount,
          ...(protectors ? { protectedBy: protectors } : {}),
          ...(kids && kids.length > 0
            ? {
                collapse: {
                  hasChildren: true,
                  collapsed: collapsed.has(nd.id),
                  hiddenCount: kids.length,
                  onToggle: () => onToggleCollapse(nd.id),
                },
              }
            : {}),
        },
      };
    });
    return l;
  }, [
    data,
    canvasEdges,
    protectedBy,
    hiddenSet,
    collapsed,
    childrenOf,
    connectedIds,
    onToggleCollapse,
    openPrByRepo,
    collapsedShelves,
    toggleShelf,
    queryIds,
  ]);

  // Undirected adjacency over the drawn edges — powers blast-radius highlighting.
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a)?.add(b);
    };
    for (const e of layout.edges) {
      link(e.source, e.target);
      link(e.target, e.source);
    }
    return adj;
  }, [layout.edges]);

  // Blast radius: the selected node + everything connected to it (up/downstream, transitively).
  // Clicking a node dims everything outside this set so you see exactly what it touches.
  const focusSet = useMemo(() => {
    if (!selectedId) return null;
    const seen = new Set<string>([selectedId]);
    const stack = [selectedId];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === undefined) break;
      for (const nb of adjacency.get(cur) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    return seen;
  }, [selectedId, adjacency]);

  // Nodes with a runtime problem — the Health lens keeps these lit and recedes everything else.
  const alertIds = useMemo(() => {
    const s = new Set<string>();
    for (const n of layout.nodes) {
      const st = (n.data as { node?: MapNode }).node?.health?.state;
      if (st === "unhealthy" || st === "degraded") s.add(n.id);
    }
    return s;
  }, [layout.nodes]);

  // Recently-changed nodes: newly observed (firstSeen within a week) or drifted (status not active).
  const changedIds = useMemo(() => {
    const s = new Set<string>();
    const now = Date.now();
    const WINDOW = 7 * 24 * 60 * 60 * 1000;
    for (const n of layout.nodes) {
      const nd = (n.data as { node?: MapNode }).node;
      if (!nd) continue;
      const fresh = !!nd.firstSeen && now - new Date(nd.firstSeen).getTime() < WINDOW;
      if (fresh || (nd.status && nd.status !== "active")) s.add(n.id);
    }
    return s;
  }, [layout.nodes]);

  // One "lit" set unifies every focus mode: an ask-query and a blast-radius click win; otherwise a
  // node is lit if it passes every ACTIVE lens (Health ∪ Changed) and the kind filter. null =
  // nothing is filtering.
  const litSet = useMemo(() => {
    if (queryIds) return queryIds;
    if (focusSet) return focusSet;
    const lensActive = healthLens || changedLens;
    if (!lensActive && kindFilter.size === 0) return null;
    const s = new Set<string>();
    for (const n of layout.nodes) {
      if (n.type !== "resource") continue;
      const kind = (n.data as { node: MapNode }).node.kind;
      const passLens =
        !lensActive || (healthLens && alertIds.has(n.id)) || (changedLens && changedIds.has(n.id));
      const passKind = kindFilter.size === 0 || kindFilter.has(kind);
      if (passLens && passKind) s.add(n.id);
    }
    return s;
  }, [queryIds, focusSet, healthLens, changedLens, kindFilter, alertIds, changedIds, layout.nodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  const { fitView } = useReactFlow();

  // Default view: frame the flow actually drawn on the canvas (nodes touched by an edge), not the
  // whole graph — otherwise the tall "unlinked" shelves shrink it to nothing. Cap zoom so it opens
  // readable, not huge.
  const fitOpts = useMemo(() => {
    const inFlow = new Set<string>();
    for (const e of layout.edges) {
      inFlow.add(e.source);
      inFlow.add(e.target);
    }
    const refs = layout.nodes.filter((n) => inFlow.has(n.id)).map((n) => ({ id: n.id }));
    return { padding: 0.2, maxZoom: 1, ...(refs.length > 0 ? { nodes: refs } : {}) };
  }, [layout.nodes, layout.edges]);

  // The Security toggle should feel like an in-place change on the SAME view — reveal/hide the
  // security groups + PROTECTS edges without re-framing the canvas (re-fitting made it feel like a
  // brand-new map you had to re-read). So we skip the fit when only `showSecurity` flipped.
  const prevSecurity = useRef(showSecurity);
  useEffect(() => {
    setNodes(layout.nodes);
    const securityToggled = prevSecurity.current !== showSecurity;
    prevSecurity.current = showSecurity;
    if (securityToggled) return;
    // Fit AFTER the store has the new nodes and painted them (double rAF) - fitting in the same
    // tick reads the stale store and zooms to the wrong box (the blank first paint).
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => void fitView({ ...fitOpts, duration: 250 }));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [layout, setNodes, fitView, fitOpts, showSecurity]);

  // Edges re-decorate on hover/selection/lens WITHOUT refitting the viewport.
  useEffect(() => {
    setEdges(decorateEdges(layout.edges, activeId, litSet));
  }, [layout, activeId, litSet, setEdges]);

  // Nodes re-decorate in place (dim) from the unified litSet (focus / lenses / filter) — no refit.
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "resource") return n;
        const dim = litSet ? !litSet.has(n.id) : false;
        if (Boolean((n.data as { dim?: boolean }).dim) === dim) return n;
        return { ...n, data: { ...n.data, dim } };
      }),
    );
  }, [litSet, setNodes, layout]);

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    onSelect(node.type === "resource" ? node.id : null);
  };
  const onNodeMouseEnter: NodeMouseHandler = (_evt, node) => {
    if (node.type === "resource") setHoveredId(node.id);
  };
  const onNodeMouseLeave: NodeMouseHandler = () => setHoveredId(null);

  // Searchable list of on-canvas resources (name + kind), and jump-to: select it (which lights its
  // blast radius) and pan/zoom the viewport to centre it.
  const searchNodes = useMemo(
    () =>
      layout.nodes
        .filter((n) => n.type === "resource")
        .map((n) => {
          const nd = (n.data as { node: MapNode }).node;
          return { id: n.id, name: nd.name ?? nd.kind, kind: nd.kind };
        }),
    [layout.nodes],
  );
  const onPick = useCallback(
    (id: string) => {
      setQueryIds(null);
      onSelect(id);
      requestAnimationFrame(
        () => void fitView({ nodes: [{ id }], duration: 500, maxZoom: 1.3, padding: 0.5 }),
      );
    },
    [onSelect, fitView],
  );

  // "Ask the map": match the query across ALL nodes (name/kind) and light every hit. Empty query
  // clears the highlight. Matching over data.nodes (not just on-canvas) so shelf hits count — the
  // layout expands the shelves whenever a query is active.
  const onSearch = useCallback(
    (q: string) => {
      const t = q.trim().toLowerCase();
      if (!t) {
        setQueryIds(null);
        return;
      }
      onSelect(null);
      const ids = new Set(
        data.nodes
          .filter(
            (n) => (n.name ?? "").toLowerCase().includes(t) || n.kind.toLowerCase().includes(t),
          )
          .map((n) => n.id),
      );
      setQueryIds(ids);
    },
    [data.nodes, onSelect],
  );

  // When a query resolves, frame its matches (once the expanded-shelf nodes have painted).
  useEffect(() => {
    if (!queryIds || queryIds.size === 0) return;
    const refs = [...queryIds].map((id) => ({ id }));
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(
        () => void fitView({ nodes: refs, duration: 500, maxZoom: 1.1, padding: 0.35 }),
      );
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [queryIds, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      nodeTypes={nodeTypes}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelect(null)}
      onInit={(inst) => void inst.fitView(fitOpts)}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      fitView
      fitViewOptions={fitOpts}
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={22}
        size={1.6}
        color="hsl(var(--muted-foreground) / 0.25)"
      />
      <Panel position="top-left">
        <MapSearch nodes={searchNodes} onPick={onPick} onSearch={onSearch} />
      </Panel>
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor="hsl(var(--muted-foreground))"
        style={{ width: 160, height: 120 }}
      />
    </ReactFlow>
  );
}

/** Find-a-resource search — floats top-left of the canvas. Matches on name/kind; picking a result
 *  selects it (lighting its blast radius) and centres the viewport on it. */
function MapSearch({
  nodes,
  onPick,
  onSearch,
}: {
  nodes: { id: string; name: string; kind: string }[];
  onPick: (id: string) => void;
  onSearch: (q: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Whether the user has arrow-navigated the suggestions — decides what Enter does (jump to the
  // navigated result vs. highlight ALL matches).
  const moved = useRef(false);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return nodes
      .filter((n) => n.name.toLowerCase().includes(t) || n.kind.toLowerCase().includes(t))
      .slice(0, 8);
  }, [q, nodes]);

  const pick = (id: string, name: string) => {
    onPick(id);
    setQ(name);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      if (matches.length === 0) return;
      e.preventDefault();
      moved.current = true;
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      if (matches.length === 0) return;
      e.preventDefault();
      moved.current = true;
      setActive((a) => (a - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Arrow-navigated → jump to that result; plain Enter → highlight every match on the canvas.
      if (moved.current && matches.length > 0) {
        const m = matches[Math.min(active, matches.length - 1)];
        if (m) pick(m.id, m.name);
      } else {
        onSearch(q);
        setOpen(false);
      }
    }
  };

  return (
    <div className="w-60">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/85 px-2.5 py-1.5 shadow-sm backdrop-blur">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            moved.current = false;
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Search or ask the map…"
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        {q ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setOpen(false);
              onSearch("");
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {open && matches.length > 0 ? (
        <ul className="mt-1 max-h-64 overflow-auto rounded-lg border border-border bg-background/95 py-1 text-xs shadow-md backdrop-blur">
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(m.id, m.name)}
                className={cn(
                  "flex w-full flex-col items-start px-2.5 py-1.5 text-left",
                  i === active ? "bg-muted" : "hover:bg-muted",
                )}
              >
                <span className="max-w-full truncate font-medium">{m.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {m.kind}
                </span>
              </button>
            </li>
          ))}
          <li className="mt-1 border-t border-border px-2.5 pb-0.5 pt-1.5 text-[10px] text-muted-foreground/70">
            ↵ Enter to highlight all matches · ↑↓ to jump to one
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/** Legend — floats top-right. Explains both the edge styles and the node states so the canvas
 *  is decodable without hovering. */
function Legend() {
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-2 rounded-lg border border-border bg-background/80 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Edges
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-4 bg-foreground" /> observed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-4 border-t border-dashed border-muted-foreground" /> inferred
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ backgroundColor: CROSS_COLOR }} />
          cross-boundary
        </span>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          Nodes
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-danger" /> unhealthy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-warning" /> degraded
        </span>
        <span className="flex items-center gap-1.5">
          <Shield className="size-3" /> protected by a security group
        </span>
      </div>
    </div>
  );
}

/** Humanize an edge type from the selected node's perspective (outgoing = it's the source). */
function relVerb(type: string, fromKind: string, outgoing: boolean): string {
  if (type === "OWNED_BY") {
    if (outgoing) return fromKind === "bitbucket.pullrequest" ? "Raised by" : "Owned by";
    return "Owns";
  }
  if (type === "CONTAINS") return outgoing ? "Contains" : "In";
  const pretty = type.toLowerCase().replace(/_/g, " ");
  return outgoing ? pretty.charAt(0).toUpperCase() + pretty.slice(1) : `${pretty} ←`;
}

function shortName(n: MapNode): string {
  return n.name ?? n.kind.replace(/^aws\.|^github\.|^external\.|^atlas\.|^bitbucket\./, "");
}

/** Turn camelCase attribute keys into readable labels ("engineVersion" → "Engine version"). */
function prettyKey(key: string): string {
  const words = key
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** ISO date → compact local form; anything else unchanged. */
function fact(v: unknown): string {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString();
  }
  return s;
}

// Shown elsewhere in the panel (or pure noise) - excluded from generic key facts.
const FACT_SKIP = new Set([
  "region",
  "accountRef",
  "health",
  "tags",
  "vpcConfig",
  "role",
  "isPrivate",
  "fullName",
  "description",
]);

/** Per-kind headline facts, then a generic scalar fallback - the panel should answer
 *  "what IS this thing" without a jump to Explore. */
function keyFacts(node: MapNode): Array<[string, string]> {
  const a = node.attributes ?? {};
  const get = (k: string): unknown => a[k];
  const out: Array<[string, string]> = [];
  const push = (label: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") out.push([label, fact(v)]);
  };

  switch (node.kind) {
    case "aws.lambda.function":
      push("Runtime", get("runtime"));
      push("Handler", get("handler"));
      break;
    case "aws.ec2.instance":
      push("Type", get("instanceType"));
      push("State", get("state"));
      push("Private IP", get("privateIp"));
      break;
    case "aws.rds.instance": {
      const engine = get("engine");
      const ver = get("engineVersion");
      push("Engine", engine ? `${String(engine)}${ver ? ` ${String(ver)}` : ""}` : undefined);
      const host = get("endpointAddress");
      push("Endpoint", host ? `${String(host)}:${String(get("endpointPort") ?? "")}` : undefined);
      break;
    }
    case "aws.elb":
      push("Type", get("type"));
      push("Scheme", get("scheme"));
      push("DNS", get("dnsName"));
      break;
    case "aws.ecs.service": {
      push("Cluster", get("cluster"));
      push("Desired tasks", get("desiredCount"));
      const td = get("taskDefinition");
      if (typeof td === "string") {
        const m = /task-definition\/(.+)$/.exec(td);
        push("Task definition", m?.[1] ?? td);
      }
      break;
    }
    case "bitbucket.repository":
      push("Language", get("language"));
      push("Main branch", get("mainBranch"));
      push("Updated", get("updatedOn"));
      break;
    default:
      break;
  }

  // Generic fallback: remaining scalar attributes, capped so the panel stays a panel.
  const seen = new Set(out.map(([l]) => l.toLowerCase()));
  for (const [k, v] of Object.entries(a)) {
    if (out.length >= 6) break;
    if (FACT_SKIP.has(k) || seen.has(prettyKey(k).toLowerCase())) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    push(prettyKey(k), v);
  }
  return out.slice(0, 6);
}

/** Kinds whose CloudWatch coverage is worth pointing at (mirrors the API's metric specs). */
const CLOUDWATCH_KINDS: Record<string, (a: Record<string, unknown>) => string | null> = {
  "aws.ec2.instance": (a) => (typeof a.instanceId === "string" ? a.instanceId : null),
  "aws.lambda.function": (a) => (typeof a.functionName === "string" ? a.functionName : null),
  "aws.rds.instance": (a) =>
    typeof a.dbInstanceIdentifier === "string" ? a.dbInstanceIdentifier : null,
  "aws.elb": (a) => (typeof a.loadBalancerName === "string" ? a.loadBalancerName : null),
  "aws.ecs.service": (a) => (typeof a.serviceName === "string" ? a.serviceName : null),
};

/**
 * Monitoring awareness, not a metrics viewer (user call): the panel says CloudWatch covers
 * this resource and deep-links into the AWS console search for it - zero API calls, nothing
 * fetched or stored. Firing alarms already surface through the health badge.
 */
function MonitoringRow({ node }: { node: MapNode }) {
  const dim = CLOUDWATCH_KINDS[node.kind]?.(node.attributes ?? {});
  if (!dim || !node.region) return null;
  const href = `https://${node.region}.console.aws.amazon.com/cloudwatch/home?region=${node.region}#metricsV2:graph=~();query=~'${encodeURIComponent(dim)}`;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Monitoring
      </p>
      <p className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">CloudWatch metrics available</span>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 font-medium underline hover:text-foreground"
        >
          Open in AWS console ↗
        </a>
      </p>
    </div>
  );
}

function DetailPanel({
  node,
  data,
  protectedBy,
  onClose,
}: {
  node: MapNode;
  data: MapData;
  protectedBy: string[];
  onClose: () => void;
}) {
  const kindShort = node.kind.replace(/^aws\.|^github\.|^external\.|^atlas\.|^bitbucket\./, "");
  const facts = keyFacts(node);

  const rels = useMemo(() => {
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const out: { verb: string; name: string }[] = [];
    for (const e of data.edges) {
      if (e.from === node.id) {
        const nb = byId.get(e.to);
        if (nb) out.push({ verb: relVerb(e.type, node.kind, true), name: shortName(nb) });
      } else if (e.to === node.id) {
        const nb = byId.get(e.from);
        if (nb) out.push({ verb: relVerb(e.type, nb.kind, false), name: shortName(nb) });
      }
    }
    // Put ownership/authorship first - it's usually what you're looking for.
    out.sort((a, b) => (a.verb.includes("by") ? -1 : 0) - (b.verb.includes("by") ? -1 : 0));
    return out;
  }, [data, node]);

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
        {node.health ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Health</dt>
            <dd
              className={cn(
                "truncate font-medium",
                node.health.state === "unhealthy"
                  ? "text-danger"
                  : node.health.state === "degraded"
                    ? "text-warning"
                    : "text-success",
              )}
              title={
                node.health.checkedAt
                  ? `checked ${new Date(node.health.checkedAt).toLocaleTimeString()}`
                  : node.health.reason
              }
            >
              {node.health.state}
              {node.health.reason ? ` · ${node.health.reason}` : ""}
            </dd>
          </div>
        ) : null}
        {facts.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
        {protectedBy.length > 0 ? (
          <Row label="Protected by" value={protectedBy.join(", ")} />
        ) : null}
        {node.region ? <Row label="Region" value={node.region} /> : null}
        {node.accountRef ? <Row label="Account" value={node.accountRef} /> : null}
      </dl>
      <div className="mt-3 flex items-center gap-2">
        <ConfidenceBadge tier={node.confidence} />
        <FreshnessTag status={node.status} />
      </div>

      <MonitoringRow node={node} />

      {rels.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Connections
          </p>
          <ul className="space-y-1 text-xs">
            {rels.slice(0, 6).map((r, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="shrink-0 text-muted-foreground">{r.verb}</span>
                <span className="min-w-0 truncate font-medium">{r.name}</span>
              </li>
            ))}
          </ul>
          {rels.length > 6 && (
            <p className="mt-1 text-[10px] text-muted-foreground">+{rels.length - 6} more</p>
          )}
        </div>
      )}

      {node.health && node.health.state !== "healthy" ? (
        <Link
          href={diagnoseHref(node)}
          className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-danger px-3 text-xs font-medium text-white hover:bg-danger/90"
        >
          <Stethoscope className="size-3.5" /> Diagnose with Atlas AI
        </Link>
      ) : null}

      <div className="mt-3 flex gap-2">
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

/** A pre-filled Ask Atlas diagnosis question (routes to the culprit/agentic diagnose tool). */
export function diagnoseHref(node: { name: string | null; kind: string }): string {
  const label = node.name ?? node.kind;
  const q = `Why is ${label} unhealthy right now? Diagnose the likely cause, what changed recently, and what depends on it.`;
  return `/ask?q=${encodeURIComponent(q)}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
