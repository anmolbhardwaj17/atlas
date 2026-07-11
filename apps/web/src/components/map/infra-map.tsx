"use client";

import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  CornerDownLeft,
  Globe,
  ListFilter,
  Map as MapIcon,
  RotateCw,
  Search,
  Shield,
  Square,
  Stethoscope,
  X,
} from "lucide-react";
import { buildLayout, containmentChildren } from "@/lib/map-layout";
import { kindShort, kindIcon, KIND_LOGO } from "@/lib/kind-visual";
import {
  edgeCrossing,
  CROSS_COLOR,
  AI_SUGGESTED_COLOR,
  type MapData,
  type MapNode,
} from "@/lib/map-types";
import { createConversation, streamAskWS } from "@/lib/browser-api";
import { CloudIcon } from "@/components/cloud-icon";
import { AtlasAiMark } from "@/components/brand";
import { ResourceNode, EnvLaneNode } from "@/components/map/resource-node";
import { ConfidenceBadge, FreshnessTag } from "@/components/certainty";
import { cn } from "@/lib/cn";

const nodeTypes = { resource: ResourceNode, envLane: EnvLaneNode };

/** Segmented-control button: one item in the map's grouped toolbar track. Active = a raised segment
 *  (bg + shadow) inside the muted track; inactive = quiet. */
const segCls = (active: boolean) =>
  cn(
    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
    active
      ? "bg-background text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground",
  );

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

export function InfraMap({
  data: rawData,
  orgId,
  focusId,
  lens,
}: {
  data: MapData;
  orgId: string;
  /** A node to open focused (from "View on map" — /map?node=<id>): selected + centred on load. */
  focusId?: string;
  /** Open with a lens pre-activated (e.g. `/map?lens=exposed` from the exposed-vulnerable finding). */
  lens?: string;
}) {
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

  // Refetch the live graph without a full reload. The map is server-rendered once (force-dynamic);
  // after a sync / Rebuild links / Find AI links changes the graph, this snapshot goes stale until
  // refreshed. `router.refresh()` re-runs the server component and reconciles new nodes/edges in
  // place, so freshly-linked repos leave the "no infra link" shelf without losing pan/zoom.
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
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

  // Exposed lens: keep only internet-reachable resources (R16 EXPOSED_VIA) lit, recede the rest —
  // "what can the internet touch". Deep-linked from the exposed-vulnerable finding (?lens=exposed).
  const [exposedLens, setExposedLens] = useState(lens === "exposed");

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
  // EXPOSED_VIA is a node-level fact (the "Internet-exposed" chip), not a drawn line — as an edge it
  // would just merge with the existing PROTECTS line to the same SG and read as noise. Keep it off
  // the canvas; the exposed set below drives the chip. PROTECTS stays overlay-gated as before.
  const canvasEdges = useMemo(
    () =>
      data.edges.filter((e) => e.type !== "EXPOSED_VIA" && (showSecurity || e.type !== "PROTECTS")),
    [data.edges, showSecurity],
  );
  // Internet-exposed compute (R16 EXPOSED_VIA, from a world-open SG or an internet-facing LB) — a
  // security-critical fact shown always, like health. The node is the `from` of the edge.
  const exposedIds = useMemo(
    () => new Set(data.edges.filter((e) => e.type === "EXPOSED_VIA").map((e) => e.from)),
    [data.edges],
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

  // Containment hierarchy for drill-down collapse (pure containment leaves only — flow
  // participants stay visible; see containmentChildren). `connectedIds` = nodes with any canvas
  // edge, so isolated nodes are dropped from the map entirely.
  const { childrenOf, connectedIds } = useMemo(() => {
    const connected = new Set<string>();
    for (const e of canvasEdges) {
      connected.add(e.from);
      connected.add(e.to);
    }
    return { childrenOf: containmentChildren(canvasEdges), connectedIds: connected };
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
            Your infrastructure and code, wired together. Follow it left to right, from entry points
            through compute into your data stores.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => setShowSecurity((v) => !v)}
              aria-pressed={showSecurity}
              title={
                showSecurity
                  ? "Hide security groups and protection edges"
                  : "Show security groups and what they protect"
              }
              className={segCls(showSecurity)}
            >
              <Shield className={cn("size-3.5", showSecurity && "text-violet-500")} />
              Security
            </button>
            <button
              type="button"
              onClick={() => setHealthLens((v) => !v)}
              aria-pressed={healthLens}
              title={
                healthLens
                  ? "Back to the normal map"
                  : "Highlight unhealthy resources, dim everything that's healthy"
              }
              className={segCls(healthLens)}
            >
              <Stethoscope className={cn("size-3.5", healthLens && "text-danger")} />
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
              className={segCls(changedLens)}
            >
              <Clock className={cn("size-3.5", changedLens && "text-sky-500")} />
              Changed
            </button>
            {exposedIds.size > 0 ? (
              <button
                type="button"
                onClick={() => setExposedLens((v) => !v)}
                aria-pressed={exposedLens}
                title={
                  exposedLens
                    ? "Back to the normal map"
                    : "Show only internet-exposed resources, dim everything else"
                }
                className={segCls(exposedLens)}
              >
                <Globe className={cn("size-3.5", exposedLens && "text-orange-500")} />
                Exposed
              </button>
            ) : null}
          </div>
          <span className="relative">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-pressed={showFilters || kindFilter.size > 0}
              title="Filter the map by resource kind"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                showFilters || kindFilter.size > 0
                  ? "border-transparent bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              <ListFilter className="size-3.5" />
              Filter
              {kindFilter.size > 0 ? (
                <span className="rounded-full bg-foreground/10 px-1 text-[10px] tabular-nums">
                  {kindFilter.size}
                </span>
              ) : null}
            </button>
            {showFilters ? (
              <div className="absolute left-0 top-full z-20 mt-1.5 max-h-72 w-56 overflow-auto rounded-lg border border-border bg-background/95 p-1.5 shadow-md backdrop-blur">
                <div className="flex items-center justify-between px-1.5 pb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    Filter by kind
                  </span>
                  {kindFilter.size > 0 ? (
                    <button
                      type="button"
                      onClick={() => setKindFilter(new Set())}
                      className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-col gap-0.5">
                  {kinds.map((k) => {
                    const on = kindFilter.has(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleKind(k)}
                        aria-pressed={on}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors",
                          on
                            ? "bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span className="grid size-5 shrink-0 place-items-center rounded bg-muted/70">
                          <KindGlyph kind={k} className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{kindShort(k)}</span>
                        {on ? <Check className="size-3.5 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={isRefreshing}
            title="Refetch the live graph — pick up links added by a recent sync or Rebuild links"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground",
              isRefreshing && "opacity-70",
            )}
          >
            <RotateCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing…" : "Refresh"}
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
            orgId={orgId}
            {...(focusId ? { focusId } : {})}
            canvasEdges={canvasEdges}
            protectedBy={protectedBy}
            selectedId={selectedId}
            onSelect={setSelectedId}
            childrenOf={childrenOf}
            connectedIds={connectedIds}
            exposedIds={exposedIds}
            collapsed={effectiveCollapsed}
            onToggleCollapse={toggleCollapse}
            showSecurity={showSecurity}
            healthLens={healthLens}
            changedLens={changedLens}
            exposedLens={exposedLens}
            kindFilter={kindFilter}
          />
        </ReactFlowProvider>
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
  orgId,
  focusId,
  canvasEdges,
  protectedBy,
  selectedId,
  onSelect,
  childrenOf,
  connectedIds,
  exposedIds,
  collapsed,
  onToggleCollapse,
  showSecurity,
  healthLens,
  changedLens,
  exposedLens,
  kindFilter,
}: {
  data: MapData;
  orgId: string;
  focusId?: string;
  canvasEdges: MapData["edges"];
  protectedBy: Map<string, string[]>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  childrenOf: Map<string, string[]>;
  connectedIds: Set<string>;
  exposedIds: Set<string>;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  showSecurity: boolean;
  healthLens: boolean;
  changedLens: boolean;
  exposedLens: boolean;
  kindFilter: Set<string>;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeId = hoveredId ?? selectedId;
  // Minimap is collapsed by default (it ate a corner); a small button toggles it.
  const [showMinimap, setShowMinimap] = useState(false);
  // "Ask the map": the set of nodes the latest AI answer cited lights up; everything else recedes
  // (null = nothing highlighted). While a set is active the shelves auto-expand so matches hiding in
  // them aren't missed. A deliberate node selection (blast radius) out-ranks this — see `litSet`.
  const [queryIds, setQueryIds] = useState<Set<string> | null>(null);
  // The docked chat conversation (empty = closed). Follow-ups reuse the same backend conversation
  // (convoRef), so Atlas keeps context turn to turn. The latest assistant turn's cited nodes feed
  // `queryIds`, so the graph lights up as Atlas cites its evidence — the P4 money shot on the canvas.
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const convoRef = useRef<string | null>(null);
  const askAbortRef = useRef<AbortController | null>(null);
  const streaming = messages.some((m) => m.role === "assistant" && STREAMING_PHASES.has(m.phase));
  // Fitting the viewport to the cited nodes is a discrete event (once, when the answer lands) — a
  // nonce triggers it, decoupled from the per-citation `queryIds` churn so the view doesn't jump
  // on every token. `queryIdsRef` lets that effect read the freshest set without depending on it.
  const [fitNonce, setFitNonce] = useState(0);
  const queryIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    queryIdsRef.current = queryIds;
  }, [queryIds]);
  const nodeById = useMemo(() => {
    const m = new Map<string, MapNode>();
    for (const n of data.nodes) m.set(n.id, n);
    return m;
  }, [data.nodes]);
  // Edge id → its endpoints, so a cited EDGE ("X depends on Y") lights both nodes it connects.
  const edgeById = useMemo(() => {
    const m = new Map<string, { from: string; to: string }>();
    for (const e of data.edges) m.set(e.id, { from: e.from, to: e.to });
    return m;
  }, [data.edges]);
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

  // Which shelves to auto-expand: any shelf holding a node that matches the active query / filter /
  // lens, so matches hiding in a collapsed shelf still surface. (A blast-radius click doesn't count
  // — its scope is on-canvas edges.)
  const shelvesForLayout = useMemo(() => {
    const active = !!queryIds || kindFilter.size > 0 || healthLens || changedLens || exposedLens;
    if (!active) return collapsedShelves;
    const now = Date.now();
    const WINDOW = 7 * 24 * 60 * 60 * 1000;
    const matches = (n: MapNode): boolean => {
      if (queryIds) return queryIds.has(n.id);
      const passHealth =
        !healthLens || n.health?.state === "unhealthy" || n.health?.state === "degraded";
      const passChanged =
        !changedLens ||
        (!!n.firstSeen && now - new Date(n.firstSeen).getTime() < WINDOW) ||
        (!!n.status && n.status !== "active");
      const passExposed = !exposedLens || exposedIds.has(n.id);
      const passKind = kindFilter.size === 0 || kindFilter.has(n.kind);
      return passHealth && passChanged && passExposed && passKind;
    };
    const expanded = new Set(collapsedShelves);
    for (const n of data.nodes) {
      // Flow nodes and IAM roles are never shelved.
      if (n.kind === "aws.iam.role" || connectedIds.has(n.id)) continue;
      if (!matches(n)) continue;
      expanded.delete(n.kind.endsWith(".repository") ? "shelf-code" : "shelf-unconnected");
    }
    return expanded;
  }, [
    queryIds,
    kindFilter,
    healthLens,
    changedLens,
    exposedLens,
    exposedIds,
    collapsedShelves,
    data.nodes,
    connectedIds,
  ]);

  const layout = useMemo(() => {
    const visibleNodes = data.nodes.filter((n) => !hiddenSet.has(n.id));
    const ids = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = canvasEdges.filter((e) => ids.has(e.from) && ids.has(e.to));
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
      const exposed = exposedIds.has(nd.id);
      if ((!kids || kids.length === 0) && openPrCount === 0 && !protectors && !exposed) return nd;
      return {
        ...nd,
        data: {
          ...nd.data,
          openPrCount,
          ...(exposed ? { exposed: true } : {}),
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
    exposedIds,
    onToggleCollapse,
    openPrByRepo,
    shelvesForLayout,
    toggleShelf,
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

  // One "lit" set unifies every focus mode. A deliberate blast-radius click wins outright (the
  // foreground act); the chat's cited nodes are the ambient glow beneath it; otherwise each active
  // lens/filter NARROWS (AND): a node stays lit only if it passes Health AND Changed AND the kind
  // filter. null = nothing is filtering (everything lit). Selection > chat citations > lenses means
  // you can jump to a resource mid-conversation and it takes over, then deselect to get the glow back.
  const litSet = useMemo(() => {
    if (focusSet) return focusSet;
    if (queryIds) return queryIds;
    if (!healthLens && !changedLens && !exposedLens && kindFilter.size === 0) return null;
    const s = new Set<string>();
    for (const n of layout.nodes) {
      if (n.type !== "resource") continue;
      const kind = (n.data as { node: MapNode }).node.kind;
      const passHealth = !healthLens || alertIds.has(n.id);
      const passChanged = !changedLens || changedIds.has(n.id);
      const passExposed = !exposedLens || exposedIds.has(n.id);
      const passKind = kindFilter.size === 0 || kindFilter.has(kind);
      if (passHealth && passChanged && passExposed && passKind) s.add(n.id);
    }
    return s;
  }, [
    queryIds,
    focusSet,
    healthLens,
    changedLens,
    exposedLens,
    kindFilter,
    alertIds,
    changedIds,
    exposedIds,
    layout.nodes,
  ]);

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
  const firstFit = useRef(true);
  useEffect(() => {
    setNodes(layout.nodes);
    const securityToggled = prevSecurity.current !== showSecurity;
    prevSecurity.current = showSecurity;
    if (securityToggled) return;
    // On the very first paint, if we arrived via "View on map" (?node=), centre on that node
    // instead of the whole flow. Otherwise frame the flow as usual.
    const focusFirst = firstFit.current && !!focusId;
    firstFit.current = false;
    // Fit AFTER the store has the new nodes and painted them (double rAF) - fitting in the same
    // tick reads the stale store and zooms to the wrong box (the blank first paint).
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(
        () =>
          void fitView(
            focusFirst
              ? { nodes: [{ id: focusId }], duration: 500, maxZoom: 1.3, padding: 0.5 }
              : { ...fitOpts, duration: 250 },
          ),
      );
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [layout, setNodes, fitView, fitOpts, showSecurity, focusId]);

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
  // Centre the viewport on one node and select it (lights its blast radius). Reused by the
  // typeahead jump and by clicking a source in the AI answer.
  const jumpTo = useCallback(
    (id: string) => {
      onSelect(id);
      requestAnimationFrame(
        () => void fitView({ nodes: [{ id }], duration: 500, maxZoom: 1.3, padding: 0.5 }),
      );
    },
    [onSelect, fitView],
  );

  // Typeahead pick: a plain resource jump — centres + selects the node. We DON'T clear the chat;
  // a selection out-ranks the chat glow in `litSet`, so it takes over and returns on deselect.
  const onPick = jumpTo;

  // Close the chat: abort any in-flight stream, drop the conversation + highlight, refit the base
  // view (the canvas widens back to full width).
  const closeChat = useCallback(() => {
    askAbortRef.current?.abort();
    askAbortRef.current = null;
    convoRef.current = null;
    setMessages([]);
    setChatOpen(false);
    setQueryIds(null);
  }, []);

  // Stop generating but keep whatever streamed so far.
  const stopAsk = useCallback(() => {
    askAbortRef.current?.abort();
    askAbortRef.current = null;
    setMessages((ms) =>
      ms.map((m, i) =>
        i === ms.length - 1 && m.role === "assistant" ? { ...m, phase: "done" } : m,
      ),
    );
  }, []);

  // Ask the map a real question (from the left command bar OR the chat's follow-up input). Routes
  // through the same retrieval-first, cited answer engine as Ask Atlas (WS + SSE fallback); reuses
  // one backend conversation so follow-ups keep context. Cited nodes (and cited-edge endpoints)
  // light up on the canvas as they stream; when the answer lands we frame them. Grounded — P1/P4.
  const runAsk = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || streaming) return;
      askAbortRef.current?.abort();
      const ac = new AbortController();
      askAbortRef.current = ac;
      onSelect(null);
      setQueryIds(null);
      setChatOpen(true);
      setMessages((ms) => [
        ...ms,
        { ...EMPTY_MSG, role: "user", text: q, phase: "done" },
        { ...EMPTY_MSG, role: "assistant", phase: "searching" },
      ]);
      // Patch the trailing assistant turn as events stream in.
      const patch = (fn: (m: ChatMsg) => ChatMsg) =>
        setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));
      const cited = new Set<string>();
      try {
        if (!convoRef.current) convoRef.current = await createConversation(orgId, q, "map");
        const convId = convoRef.current;
        if (!convId) {
          patch((m) => ({ ...m, phase: "error", error: "Couldn’t start a conversation." }));
          return;
        }
        for await (const ev of streamAskWS(orgId, convId, q, ac.signal)) {
          if (ac.signal.aborted) return;
          switch (ev.type) {
            case "retrieval_step": {
              const label = toolLabel(ev.tool);
              patch((m) => ({
                ...m,
                phase: "searching",
                steps: m.steps[m.steps.length - 1] === label ? m.steps : [...m.steps, label],
              }));
              break;
            }
            case "retrieval":
              patch((m) => ({ ...m, phase: "thinking" }));
              break;
            case "token":
              patch((m) => ({ ...m, phase: "answering", text: m.text + ev.text }));
              break;
            case "citation": {
              const c = ev.citation;
              // A node citation lights that node; an edge citation lights both endpoints (only ids
              // actually on the map). Keep insertion order for the Source chips.
              const before = cited.size;
              if (c.kind === "node") {
                if (nodeById.has(c.id)) cited.add(c.id);
              } else if (c.kind === "edge") {
                const e = edgeById.get(c.id);
                if (e) {
                  if (nodeById.has(e.from)) cited.add(e.from);
                  if (nodeById.has(e.to)) cited.add(e.to);
                }
              }
              const grew = cited.size > before;
              patch((m) => ({
                ...m,
                citations: [
                  ...m.citations,
                  {
                    number: c.number,
                    marker: c.marker,
                    kind: c.kind,
                    id: c.id,
                    confidence: c.confidence,
                  },
                ],
                ...(grew ? { nodeIds: [...cited] } : {}),
              }));
              if (grew) setQueryIds(new Set(cited));
              break;
            }
            case "confidence":
              patch((m) => ({ ...m, confidence: ev.overall, caveats: ev.caveats }));
              break;
            case "error":
              patch((m) => ({ ...m, phase: "error", error: ev.message }));
              break;
            case "done":
              break;
          }
        }
        patch((m) => ({ ...m, phase: m.phase === "error" ? "error" : "done" }));
        if (cited.size > 0) setFitNonce((n) => n + 1);
      } catch {
        if (!ac.signal.aborted) {
          patch((m) => ({ ...m, phase: "error", error: "The stream was interrupted." }));
        }
      } finally {
        if (askAbortRef.current === ac) askAbortRef.current = null;
      }
    },
    [orgId, onSelect, nodeById, edgeById, streaming],
  );

  // Frame the cited nodes — once, when the answer lands (bumped nonce), after the expanded-shelf
  // nodes have painted (and after the dock has taken its width, so we fit inside the visible canvas).
  useEffect(() => {
    if (fitNonce === 0) return;
    const ids = queryIdsRef.current;
    if (!ids || ids.size === 0) return;
    const refs = [...ids].map((id) => ({ id }));
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(
        () => void fitView({ nodes: refs, duration: 500, maxZoom: 1.1, padding: 0.4 }),
      );
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [fitNonce, fitView]);

  // When the dock opens/closes the canvas width changes — gently reframe (to the cited set if one is
  // lit, else the base flow) so nothing ends up half-hidden behind the dock.
  const prevChatOpen = useRef(chatOpen);
  useEffect(() => {
    if (prevChatOpen.current === chatOpen) return;
    prevChatOpen.current = chatOpen;
    const raf = requestAnimationFrame(() => {
      const ids = queryIdsRef.current;
      if (ids && ids.size > 0) {
        void fitView({
          nodes: [...ids].map((id) => ({ id })),
          duration: 300,
          maxZoom: 1.1,
          padding: 0.4,
        });
      } else {
        void fitView({ ...fitOpts, duration: 300 });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [chatOpen, fitView, fitOpts]);

  // Abort a running stream if the map unmounts.
  useEffect(() => () => askAbortRef.current?.abort(), []);

  const selected = selectedId ? (data.nodes.find((n) => n.id === selectedId) ?? null) : null;

  return (
    <div className="flex h-full w-full">
      {/* Canvas column — shrinks when the chat docks so nothing hides behind it. */}
      <div className="relative min-w-0 flex-1">
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
            <div className="w-72 max-w-[calc(100vw-2rem)]">
              <MapSearch nodes={searchNodes} onPick={onPick} onAsk={runAsk} />
            </div>
          </Panel>
          <Controls showInteractive={false} />
          {showMinimap ? (
            <MiniMap
              pannable
              zoomable
              nodeColor="hsl(var(--muted-foreground))"
              style={{ width: 160, height: 120, bottom: 48 }}
            />
          ) : null}
          <Panel position="bottom-right">
            <button
              type="button"
              onClick={() => setShowMinimap((v) => !v)}
              title={showMinimap ? "Hide minimap" : "Show minimap"}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/85 px-2 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
            >
              <MapIcon className="size-3.5" />
              {showMinimap ? "Hide map" : "Minimap"}
            </button>
          </Panel>
        </ReactFlow>
        {!selected && <Legend />}
        {selected && (
          <DetailPanel
            node={selected}
            protectedBy={protectedBy.get(selected.id) ?? []}
            onClose={() => onSelect(null)}
          />
        )}
      </div>
      {/* Docked chat — the map's conversational sidekick (P4: citations light the canvas). */}
      {chatOpen ? (
        <aside className="flex w-[340px] max-w-[42%] shrink-0 flex-col border-l border-border bg-card">
          <MapChat
            messages={messages}
            streaming={streaming}
            resolve={(id) => nodeById.get(id) ?? null}
            onJump={jumpTo}
            onAsk={runAsk}
            onStop={stopAsk}
            onClose={closeChat}
          />
        </aside>
      ) : null}
    </div>
  );
}

/** The brand/kind glyph for a resource kind — the real cloud/service logo when we have one, else
 *  the kind's lucide icon. Mirrors ResourceNode so search + filters read like the canvas. */
function KindGlyph({ kind, className = "" }: { kind: string; className?: string }) {
  const logo = KIND_LOGO[kind];
  if (logo) return <CloudIcon name={logo} className={className} />;
  const Icon = kindIcon(kind);
  return <Icon className={className} />;
}

// ── Ask the map (AI) ─────────────────────────────────────────────────────────
interface AskCitation {
  number: number;
  marker: string;
  kind: "node" | "edge" | "computed";
  id: string;
  confidence: string | null;
}
/** One turn in the map chat. User turns use only role+text; assistant turns carry the streamed
 *  answer, its cited nodes, and a confidence tier. */
interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  /** searching/thinking = pre-token wait; answering = streaming; done/error = settled. */
  phase: "searching" | "thinking" | "answering" | "done" | "error";
  steps: string[];
  citations: AskCitation[];
  /** The on-map nodes the answer grounds in (node citations + endpoints of cited edges), in the
   *  order first cited — these light up on the canvas and appear as clickable Source chips. */
  nodeIds: string[];
  confidence: string | null;
  caveats: string[];
  error: string | null;
}

const EMPTY_MSG: ChatMsg = {
  role: "assistant",
  text: "",
  phase: "done",
  steps: [],
  citations: [],
  nodeIds: [],
  confidence: null,
  caveats: [],
  error: null,
};
const STREAMING_PHASES = new Set(["searching", "thinking", "answering"]);

/** Friendly label for a retrieval tool (the agentic loop's "show your work" trace). Mirrors the
 *  Ask Atlas page so the map speaks the same language. */
function toolLabel(tool: string): string {
  switch (tool) {
    case "search":
      return "Searched the graph";
    case "get_node":
      return "Read a node";
    case "get_neighbors":
      return "Read relationships";
    case "traverse":
      return "Traced impact";
    case "timeline":
      return "Checked recent changes";
    case "estate_overview":
      return "Read estate overview";
    default:
      return `Ran ${tool}`;
  }
}

/** Quiet trust line: a coloured dot + label + source count (mirrors Ask Atlas' TrustHint). */
const TRUST_FALLBACK = { dot: "bg-muted-foreground", label: "No grounded data" };
const TRUST: Record<string, { dot: string; label: string }> = {
  observed: { dot: "bg-success", label: "Observed" },
  "inferred-high": { dot: "bg-warning", label: "Inferred" },
  "inferred-low": { dot: "bg-warning", label: "Inferred · low confidence" },
  advisory: { dot: "bg-brand", label: "Recommendation" },
  insufficient: TRUST_FALLBACK,
};

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 leading-none" aria-label="Thinking">
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.2s]" />
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.1s]" />
      <span className="size-1 animate-bounce rounded-full bg-muted-foreground/60" />
    </span>
  );
}

/** Render the model's light markdown inline — **bold**, `code`, and citation markers ([N1]/[E2]/…).
 *  On the map, a NODE citation is a button that jumps to it on the canvas; edge/computed markers
 *  deep-link out to Explore. Unresolved markers (citations arrive after tokens) stay hidden. */
function renderMapRich(
  text: string,
  cites: Map<string, AskCitation>,
  onJump: (id: string) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([NEA]\d+)\]/g;
  const sup =
    "mx-px inline-flex h-3.5 min-w-3.5 items-center justify-center rounded bg-muted px-0.5 align-super text-[10px] font-medium text-muted-foreground transition-colors hover:bg-foreground hover:text-background";
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={key++}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      out.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {m[2]}
        </code>,
      );
    } else {
      const c = cites.get(m[3] as string);
      if (c && c.kind === "node") {
        out.push(
          <button
            key={key++}
            type="button"
            onClick={() => onJump(c.id)}
            title={`Source ${c.number} · jump to it on the map`}
            className={sup}
          >
            {c.number}
          </button>,
        );
      } else if (c) {
        out.push(
          <Link
            key={key++}
            href={c.kind === "edge" ? `/explore/edge/${c.id}` : "/dashboard"}
            title={`Source ${c.number}`}
            className={sup}
          >
            {c.number}
          </Link>,
        );
      }
      // unresolved marker → dropped until its citation arrives
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * The docked map chat — the conversational sidekick beside the graph. A scrollable transcript of
 * turns + a follow-up input pinned to the bottom. Same retrieval-first, cited engine as Ask Atlas;
 * the latest answer's cited nodes light up on the canvas (P4), and every source jumps you to it.
 * An insufficient-grounding answer reads as an honest "I don't know" (US-11), never a fabrication.
 */
function MapChat({
  messages,
  streaming,
  resolve,
  onJump,
  onAsk,
  onStop,
  onClose,
}: {
  messages: ChatMsg[];
  streaming: boolean;
  resolve: (id: string) => MapNode | null;
  onJump: (id: string) => void;
  onAsk: (q: string) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  // Keep the newest turn in view as it streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const submit = () => {
    const q = input.trim();
    if (!q || streaming) return;
    onAsk(q);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
        <AtlasAiMark size={16} className="shrink-0" />
        <span className="flex-1 text-sm font-semibold text-foreground">Ask Atlas</span>
        <button
          type="button"
          onClick={onClose}
          title="Close chat"
          aria-label="Close chat"
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <UserBubble key={i} text={m.text} />
          ) : (
            <AssistantTurn key={i} msg={m} resolve={resolve} onJump={onJump} />
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex shrink-0 items-center gap-2 border-t border-border p-2.5"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a follow-up…"
          aria-label="Ask a follow-up"
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/40"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop generating"
            aria-label="Stop generating"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            <Square className="size-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            title="Ask"
            aria-label="Ask"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}

/** A question the user asked — right-aligned bubble. */
function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground px-3 py-1.5 text-xs leading-relaxed text-background">
        {text}
      </div>
    </div>
  );
}

/** One assistant answer: the retrieval trace while it thinks, then the cited answer, its caveats,
 *  the grounded on-map sources (click to jump), and a confidence tier. */
function AssistantTurn({
  msg,
  resolve,
  onJump,
}: {
  msg: ChatMsg;
  resolve: (id: string) => MapNode | null;
  onJump: (id: string) => void;
}) {
  const streaming = STREAMING_PHASES.has(msg.phase);
  const thinking = streaming && msg.text.length === 0;
  const honest = msg.confidence === "insufficient";
  const citeByMarker = useMemo(
    () => new Map(msg.citations.map((c) => [c.marker, c])),
    [msg.citations],
  );
  const sources = msg.nodeIds;
  const trust = msg.confidence ? (TRUST[msg.confidence] ?? TRUST_FALLBACK) : null;

  return (
    <div className="flex gap-2.5">
      <AtlasAiMark
        size={18}
        className={cn("mt-0.5 size-[18px] shrink-0", thinking && "animate-ai-pulse")}
      />
      <div className="min-w-0 flex-1 space-y-2 text-xs leading-relaxed">
        {msg.error ? (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1.5 text-danger">
            {msg.error}
          </p>
        ) : thinking ? (
          <div className="space-y-1.5">
            <span className="flex items-center gap-2 text-muted-foreground">
              <TypingDots />
              {msg.phase === "thinking" ? "Thinking…" : "Searching your graph…"}
            </span>
            {msg.steps.length > 0 ? (
              <ul className="space-y-0.5 pl-0.5">
                {msg.steps.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                  >
                    <Check className="size-3 shrink-0 text-success" />
                    {s}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : msg.text.length === 0 ? (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-warning">
            No answer came back — the model may be rate-limited. Try again, or pick a model in
            Settings.
          </p>
        ) : (
          <p
            className={cn(
              "whitespace-pre-wrap",
              honest ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {renderMapRich(msg.text, citeByMarker, onJump)}
            {streaming ? <span className="ml-0.5 animate-pulse">▌</span> : null}
          </p>
        )}

        {msg.caveats.length > 0 ? (
          <ul className="space-y-0.5">
            {msg.caveats.map((c) => (
              <li key={c} className="text-[11px] text-inferred-low">
                ⚠ {c}
              </li>
            ))}
          </ul>
        ) : null}

        {!thinking && sources.length > 0 ? (
          <div className="space-y-1 pt-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
              On the map
            </span>
            <div className="flex flex-wrap gap-1">
              {sources.map((id) => {
                const n = resolve(id);
                if (!n) return null;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onJump(id)}
                    title="Jump to it on the map"
                    className="inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                  >
                    <KindGlyph kind={n.kind} className="size-3 shrink-0" />
                    <span className="truncate">{n.name ?? n.kind}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {trust && !streaming ? (
          <div className="flex items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className={cn("size-1.5 rounded-full", trust.dot)} />
              {trust.label}
            </span>
            {msg.citations.length > 0 ? (
              <span className="text-muted-foreground/70">
                · {msg.citations.length} source{msg.citations.length > 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The map command bar — floats top-left of the canvas. Two jobs in one box: type a resource name
 *  to JUMP to it (typeahead), or ask a natural-language question to route through Atlas AI, which
 *  lights the cited nodes on the canvas. The first dropdown row is always the AI ask (default
 *  Enter action); resource matches follow. Arrow keys move through both. */
function MapSearch({
  nodes,
  onPick,
  onAsk,
}: {
  nodes: { id: string; name: string; kind: string }[];
  onPick: (id: string) => void;
  onAsk: (q: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // Active row: 0 = the "Ask Atlas" action, 1..n = resource matches. Defaults to 0 so a plain Enter
  // asks the question; arrow down into the list to jump to a specific resource instead.
  const [active, setActive] = useState(0);
  // Animated placeholder: crossfade the leading glyph + hint between "search" and "ask" while the
  // box is empty AND unfocused, so it advertises both jobs without fighting you once you're in it.
  const [phase, setPhase] = useState(0);
  const [focused, setFocused] = useState(false);
  const animating = !q && !focused;
  useEffect(() => {
    if (!animating) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % 2), 3200);
    return () => clearInterval(id);
  }, [animating]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return nodes
      .filter((n) => n.name.toLowerCase().includes(t) || n.kind.toLowerCase().includes(t))
      .slice(0, 6);
  }, [q, nodes]);
  const rowCount = matches.length + 1; // +1 for the Ask row at index 0

  const pick = (id: string, name: string) => {
    onPick(id);
    setQ(name);
    setOpen(false);
  };
  const askNow = () => {
    if (!q.trim()) return;
    onAsk(q);
    setOpen(false);
  };
  const clear = () => {
    setQ("");
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % rowCount);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a - 1 + rowCount) % rowCount);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Row 0 (or nothing navigated) → ask Atlas; any resource row → jump to it.
      if (active === 0) {
        askNow();
      } else {
        const m = matches[active - 1];
        if (m) pick(m.id, m.name);
        else askNow();
      }
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/85 px-2.5 py-1.5 shadow-sm backdrop-blur">
        {/* Crossfading glyph: magnifier ⇄ Atlas AI mark (only while idle & empty). */}
        <span className="relative size-3.5 shrink-0 text-muted-foreground">
          <Search
            className={cn(
              "absolute inset-0 size-3.5 transition-opacity duration-700",
              !animating || phase === 0 ? "opacity-100" : "opacity-0",
            )}
          />
          {animating ? (
            <AtlasAiMark
              size={14}
              className={cn(
                "absolute inset-0 transition-opacity duration-700",
                phase === 1 ? "opacity-100" : "opacity-0",
              )}
            />
          ) : null}
        </span>
        <div className="relative min-w-0 flex-1">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            onFocus={() => {
              setFocused(true);
              setOpen(true);
            }}
            onBlur={() => {
              setFocused(false);
              setTimeout(() => setOpen(false), 120);
            }}
            placeholder=""
            className="w-full bg-transparent text-xs outline-none"
          />
          {/* Placeholder. Idle+empty → crossfade the two hints; focused+empty → a plain static hint
              so it doesn't fight your typing. */}
          {!q ? (
            animating ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-xs text-muted-foreground"
              >
                <span
                  className={cn(
                    "absolute transition-all duration-500",
                    phase === 0 ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
                  )}
                >
                  Search the map…
                </span>
                <span
                  className={cn(
                    "absolute transition-all duration-500",
                    phase === 1 ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
                  )}
                >
                  Ask the map anything…
                </span>
              </span>
            ) : (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center text-xs text-muted-foreground"
              >
                Search or ask the map…
              </span>
            )
          ) : null}
        </div>
        {q ? (
          <button
            type="button"
            onClick={clear}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Clear"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {open && q.trim() ? (
        <ul className="mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-background/95 py-1 text-xs shadow-md backdrop-blur">
          {/* Row 0 — ask Atlas the whole question. */}
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(0)}
              onClick={askNow}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
                active === 0 ? "bg-muted" : "hover:bg-muted",
              )}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand/10">
                <AtlasAiMark size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  Ask Atlas: <span className="text-muted-foreground">“{q.trim()}”</span>
                </span>
                <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  Grounded, cited answer
                </span>
              </span>
              <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground/60" />
            </button>
          </li>
          {matches.length > 0 ? (
            <>
              <li className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                Jump to a resource
              </li>
              {matches.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i + 1)}
                    onClick={() => pick(m.id, m.name)}
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-1.5 text-left",
                      active === i + 1 ? "bg-muted" : "hover:bg-muted",
                    )}
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted/60">
                      <KindGlyph kind={m.kind} className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block max-w-full truncate font-medium">{m.name}</span>
                      <span className="block truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                        {m.kind}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/** Legend — floats top-right. Collapsed to a small pill by default (it ate real estate); click to
 *  expand the full edge + node key. */
function Legend() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground"
      >
        <ChevronDown className="size-3.5" />
        Legend
      </button>
    );
  }
  return (
    <div className="absolute right-3 top-3 z-10 flex w-44 flex-col gap-2 rounded-lg border border-border bg-background/80 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-foreground"
      >
        Legend
        <ChevronDown className="size-3.5 rotate-180" />
      </button>
      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
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
          <span
            className="h-0 w-4 border-t border-dotted"
            style={{ borderColor: AI_SUGGESTED_COLOR }}
          />
          AI-suggested
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
  protectedBy,
  onClose,
}: {
  node: MapNode;
  protectedBy: string[];
  onClose: () => void;
}) {
  const kindShort = node.kind.replace(/^aws\.|^github\.|^external\.|^atlas\.|^bitbucket\./, "");
  const facts = keyFacts(node);

  return (
    <div className="absolute right-3 top-3 z-10 w-80 rounded-lg border border-border bg-card p-4 shadow-lg">
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
          <div className="flex justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">Health</dt>
            <dd
              className={cn(
                "min-w-0 break-words text-right font-medium",
                node.health.state === "unhealthy"
                  ? "text-danger"
                  : node.health.state === "degraded"
                    ? "text-warning"
                    : "text-success",
              )}
              // The checked-at time is locale/timezone-formatted, so the server string ("… AM")
              // and the browser's ("… am") legitimately differ — tell React not to flag the diff.
              suppressHydrationWarning
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

      {node.health && node.health.state !== "healthy" ? (
        <Link
          href={diagnoseHref(node)}
          className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          <AtlasAiMark size={14} className="shrink-0" /> Diagnose with Atlas AI
        </Link>
      ) : null}

      <Link
        href={`/explore/${node.id}`}
        className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-md border border-border px-3 text-xs font-medium transition-colors hover:border-foreground/40"
      >
        View details
      </Link>
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
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}
