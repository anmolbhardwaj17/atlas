/**
 * Inference engine contract (docs/05 §6). Rules are PURE functions of the org's current
 * nodes + signals (+ some observed edges) → candidate inferred edges (IE-1 deterministic,
 * IE-2 explainable via evidence). The engine resolves URNs → ids, upserts with
 * provenance, and retires candidates a rule no longer produces (IE-4 convergent).
 */

export type ConfidenceTier = "inferred-high" | "inferred-low";

/** A graph node as the rules see it (hot columns + attributes). */
export interface NodeLite {
  id: string;
  urn: string;
  kind: string;
  attributes: Record<string, unknown>;
}

/** An inference-input signal (docs/05 §6.3). */
export interface SignalLite {
  subjectUrn: string;
  kind: string;
  data: Record<string, unknown>;
}

/** An observed edge a rule may build on (e.g. R8 reads ASSUMES_ROLE). */
export interface ObservedEdgeLite {
  fromUrn: string;
  toUrn: string;
  type: string;
}

/** Everything a rule reads, pre-indexed for cheap lookup. */
export interface InferenceInput {
  nodesByUrn: Map<string, NodeLite>;
  nodesByKind: Map<string, NodeLite[]>;
  signals: SignalLite[];
  signalsByKind: Map<string, SignalLite[]>;
  observedEdges: ObservedEdgeLite[];
}

/** A candidate edge a rule proposes (URNs; the engine resolves to node ids). */
export interface InferredEdge {
  type: string;
  fromUrn: string;
  toUrn: string;
  tier: ConfidenceTier;
  /** Signal refs / reasoning that justify the edge (docs/05 §6.2, stored on provenance). */
  evidence: Record<string, unknown>;
}

/** A registered, versioned inference rule (docs/05 §6.2). */
export interface Rule {
  readonly key: string;
  readonly version: number;
  /** Pure: current graph state → candidate edges. */
  evaluate(input: InferenceInput): InferredEdge[];
}

export interface InferenceStats {
  candidates: number;
  upserted: number;
  retired: number;
}
