/**
 * The registered rule set the engine runs (docs/05 §6.4), in DEPENDENCY ORDER: rules
 * that consume another rule's edges must run after it (the engine folds each rule's
 * output back into the input). R1 (DEPLOYS_TO) → R4 (service + IMPLEMENTS/RUNS) →
 * R5-propagation (service OWNED_BY, reads IMPLEMENTS) + R6 (CHANGED_BY, reads IMPLEMENTS).
 * Each rule is pure and independently testable.
 */
import type { Rule } from "../types";
import { repoDeploysToRuntimeRule } from "./r1-deploys";
import { serviceDerivationRule } from "./r4-service";
import { ownershipPropagationRule } from "./r5-ownership";
import { prChangesServiceRule } from "./r6-changed";
import { sgCorrelationConnectsRule } from "./r2-sg";
import { configRefConnectsRule } from "./r3-config";
import { iamAccessConnectsRule } from "./r8-iam";

export const ALL_RULES: readonly Rule[] = [
  // Connection rules (R2/R3/R8) are independent of R1/R4 and can run first or last.
  sgCorrelationConnectsRule,
  configRefConnectsRule,
  iamAccessConnectsRule,
  // Deploy → service chain (dependency-ordered).
  repoDeploysToRuntimeRule,
  serviceDerivationRule,
  ownershipPropagationRule,
  prChangesServiceRule,
];

export { repoDeploysToRuntimeRule } from "./r1-deploys";
export { serviceDerivationRule } from "./r4-service";
export { ownershipPropagationRule } from "./r5-ownership";
export { prChangesServiceRule } from "./r6-changed";
export { sgCorrelationConnectsRule } from "./r2-sg";
export { configRefConnectsRule } from "./r3-config";
export { iamAccessConnectsRule } from "./r8-iam";
