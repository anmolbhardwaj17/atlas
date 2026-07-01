/**
 * @atlas/inference — the deterministic, rule-based inference engine (docs/05 §6). Reads
 * the graph's nodes + signals + observed edges and derives the cross-source inferred
 * edges (DEPLOYS_TO, CONNECTS_TO, IMPLEMENTS/RUNS, CHANGED_BY, …) that make the graph
 * the product (P1). Rule-based, not ML, for explainability + precision (DD-2/P9/P3).
 */
export { runInference } from "./engine";
export type { InferenceDeps, InferenceLogger } from "./engine";
export { ALL_RULES, repoDeploysToRuntimeRule } from "./rules";
export type {
  Rule,
  InferenceInput,
  InferredEdge,
  InferenceStats,
  NodeLite,
  SignalLite,
  ObservedEdgeLite,
  ConfidenceTier,
} from "./types";
