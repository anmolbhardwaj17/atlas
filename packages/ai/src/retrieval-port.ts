/**
 * Retrieval contract (docs/10 §4.3). The AI engine reads the graph ONLY through this
 * port — the API implements it over the G2 GraphService + SearchProvider (docs/08 §9,
 * docs/11). Keeping the engine behind a port makes it NestJS-free and unit-testable with
 * a fake port, and keeps retrieval the authoritative, org-scoped, bounded source (AE-4/AE-7).
 * Every operation is org-scoped; the engine never sees another tenant's data (R8).
 */

export interface SearchHit {
  id: string;
  kind: string;
  name: string | null;
  score: number;
}

export interface RetrievedNode {
  id: string;
  urn: string;
  kind: string;
  name: string | null;
  status: string;
  confidence: string;
  region: string | null;
  provenance: { source: string | null; rawSnapshotRef: string | null } | null;
}

export interface ViaEdge {
  edgeId: string;
  type: string;
  confidence: string;
  evidence: Record<string, unknown>;
  rule: string | null;
}

export interface TraversalImpacted {
  node: { id: string; urn: string; kind: string; name: string | null };
  distance: number;
  via: ViaEdge[];
  pathConfidence: string;
}

export interface Traversal {
  root: { id: string; urn: string; kind: string; name: string | null };
  impacted: TraversalImpacted[];
  warnings: string[];
  truncated: boolean;
}

export interface RetrievedEdge {
  id: string;
  type: string;
  confidence: string;
  from: { id: string; urn: string; name: string | null };
  to: { id: string; urn: string; name: string | null };
}

export interface TimelineChange {
  changeKind: "node" | "edge";
  changeType: "created" | "updated";
  at: string;
  entity: Record<string, unknown>;
}

export interface TraversalOpts {
  depth?: number;
  minConfidence?: "observed" | "inferred-high" | "inferred-low";
}

/**
 * A whole-org aggregate snapshot (docs/plans/ai-knowledge-engine — P0 estate slice). These are
 * COMPUTED facts (counts/rankings over many nodes), not single graph nodes — the context builder
 * cites them as computed facts, not to one node id. Reuses the dashboard summary aggregation
 * (GraphService.summary), so Ask AI and the dashboard agree by construction.
 */
export interface EstateOverview {
  inventory: {
    resources: number;
    relationships: number;
    services: number;
    datastores: number;
    environments: number;
    clouds: number;
    accounts: number;
    repositories: number;
    projects: number;
    pipelines: number;
    contributors: number;
    pullRequests: number;
  };
  crossBoundary: { crossCloud: number; crossAccount: number };
  /** PR-activity leaderboards over the last 30 days (name + count). */
  topContributors: Array<{ name: string; count: number }>;
  mostActiveRepos: Array<{ name: string; count: number }>;
  pipelineCoverage: { withPipeline: number; total: number };
  /** "Needs attention" facts the graph proves. `category` keys into the advisory knowledge pack. */
  findings: Array<{ title: string; severity: string; category: string; count?: number }>;
  sources: { total: number; healthy: number; lastSyncAt: string | null };
}

export interface RetrievalPort {
  search(orgId: string, q: string, limit: number): Promise<SearchHit[]>;
  getNode(orgId: string, id: string): Promise<RetrievedNode | null>;
  blastRadius(orgId: string, id: string, opts: TraversalOpts): Promise<Traversal>;
  dependencies(orgId: string, id: string, opts: TraversalOpts): Promise<Traversal>;
  edges(orgId: string, id: string, direction: "in" | "out" | "both"): Promise<RetrievedEdge[]>;
  timeline(
    orgId: string,
    since: string,
    kinds: string[] | null,
    limit: number,
  ): Promise<TimelineChange[]>;
  /** Whole-org aggregate snapshot for estate/aggregate questions (P0 estate slice). */
  estateOverview(orgId: string): Promise<EstateOverview>;
}
