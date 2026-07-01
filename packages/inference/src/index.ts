/**
 * @atlas/inference — the deterministic, rule-based inference engine (docs/05 §6). Reads
 * the graph's nodes + signals + observed edges and derives the cross-source inferred
 * edges (DEPLOYS_TO, CONNECTS_TO, IMPLEMENTS/RUNS, CHANGED_BY, …) that make the graph
 * the product (P1). Rule-based, not ML, for explainability + precision (DD-2/P9/P3).
 */
export { runInference } from "./engine";
export type { InferenceDeps, InferenceLogger } from "./engine";
export { evaluateAll } from "./evaluate";
export type { EvaluatedPlan } from "./evaluate";
export {
  ALL_RULES,
  repoDeploysToRuntimeRule,
  serviceDerivationRule,
  ownershipPropagationRule,
  prChangesServiceRule,
  sgCorrelationConnectsRule,
  configRefConnectsRule,
  iamAccessConnectsRule,
} from "./rules";
export type {
  Rule,
  RuleOutput,
  InferenceInput,
  InferredEdge,
  DerivedNode,
  InferenceStats,
  NodeLite,
  SignalLite,
  EdgeLite,
  ObservedEdgeLite,
  ConfidenceTier,
} from "./types";
