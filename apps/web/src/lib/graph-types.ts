/** Mirror of the read-API shapes (docs/08 §9) the Explore surface consumes. */

export interface NodeDto {
  id: string;
  urn: string;
  kind: string;
  name: string | null;
  provider: string;
  region: string | null;
  status: string;
  confidence: string;
  attributes: Record<string, unknown>;
  tags: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
}

export interface NodeProvenance {
  source: string | null;
  syncRunId: string | null;
  observedAt: string | null;
  confidence: string | null;
  rawSnapshotId: string | null;
  rawSnapshotRef: string | null;
}

export type NodeDetail = NodeDto & { provenance: NodeProvenance | null };

export interface EdgeEndpoint {
  id: string;
  urn: string;
  kind: string;
  name: string | null;
}

export interface EdgeDto {
  id: string;
  type: string;
  origin: string;
  confidence: string;
  status: string;
  from: EdgeEndpoint;
  to: EdgeEndpoint;
}

export interface EdgeDetail {
  id: string;
  type: string;
  origin: string;
  confidence: string;
  status: string;
  from: EdgeEndpoint;
  to: EdgeEndpoint;
  rule: string | null;
  evidence: Record<string, unknown>;
  provenance: {
    source: string | null;
    observedAt: string | null;
    rawSnapshotId: string | null;
    rawSnapshotRef: string | null;
  };
  firstSeen: string;
  lastSeen: string;
}
