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
}
