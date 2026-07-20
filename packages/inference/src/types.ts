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
  /** Display name (e.g. a PR's `#12 — title`) — optional so test fixtures can omit it. */
  name?: string | null;
  attributes: Record<string, unknown>;
}

/** An inference-input signal (docs/05 §6.3). */
export interface SignalLite {
  subjectUrn: string;
  kind: string;
  data: Record<string, unknown>;
}

/** An edge a rule may build on. Observed edges + earlier rules' inferred edges (this run). */
export interface EdgeLite {
  fromUrn: string;
  toUrn: string;
  type: string;
  tier?: ConfidenceTier;
}
/** @deprecated alias — kept for readability where only observed edges are meant. */
export type ObservedEdgeLite = EdgeLite;

/** Everything a rule reads, pre-indexed for cheap lookup. */
export interface InferenceInput {
  /** Org slug — for derived URNs like `atlas:<slug>:service:<key>` (docs/05 §2.2). */
  orgSlug: string;
  nodesByUrn: Map<string, NodeLite>;
  nodesByKind: Map<string, NodeLite[]>;
  signals: SignalLite[];
  signalsByKind: Map<string, SignalLite[]>;
  observedEdges: EdgeLite[];
  /** `${fromNodeId}→${toNodeId}→${type}` pairs a user REMOVED/rejected — the engine must not
   *  re-produce them (docs/05; manual-graph-editing). Keyed by node id, matching resolved candidates.
   *  Optional so rule unit-tests can omit it (undefined ⇒ nothing rejected). */
  rejectedEdgeKeys?: Set<string>;
  /** Inferred edges produced by EARLIER rules this run (dependency-ordered; e.g. R4
   *  reads R1's DEPLOYS_TO). The engine appends each rule's kept edges as it runs. */
  inferredEdges: EdgeLite[];
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

/** A node a rule synthesizes (docs/05 §3.3, e.g. `atlas.service`). Upserted by URN. */
export interface DerivedNode {
  urn: string;
  kind: string;
  displayName: string;
  attributes: Record<string, unknown>;
  tier: ConfidenceTier;
}

/** What a rule produces: derived nodes (upserted first, so its edges resolve) + edges. */
export interface RuleOutput {
  nodes: DerivedNode[];
  edges: InferredEdge[];
}

/** A registered, versioned inference rule (docs/05 §6.2). */
export interface Rule {
  readonly key: string;
  readonly version: number;
  /**
   * The node kinds this rule reads via `input.nodesByKind.get(kind)` (C2). The engine loads full
   * `attributes` only for the union of every registered rule's `consumesKinds` and blanks the rest,
   * to bound inference memory on large tenants. MUST list every kind the rule passes to
   * `nodesByKind.get` (endpoint resolution via `nodesByUrn` needs no declaration — those nodes are
   * always loaded). Over-declaring is safe (loads a little extra); under-declaring would blank an
   * attribute the rule reads → the `consumption-contract` test fails rather than dropping edges.
   * Declare from the rule's own const arrays so it can't drift. `[]` if the rule reads no attributes.
   */
  readonly consumesKinds: readonly string[];
  /** The signal kinds this rule reads via `input.signalsByKind.get(kind)` (C2). Same contract as
   *  {@link consumesKinds}: the engine loads only these signals; the contract test enforces it. */
  readonly consumesSignalKinds: readonly string[];
  /** Pure: current graph state → derived nodes + candidate edges. */
  evaluate(input: InferenceInput): RuleOutput;
}

export interface InferenceStats {
  candidates: number;
  upserted: number;
  retired: number;
  derivedNodes: number;
}
