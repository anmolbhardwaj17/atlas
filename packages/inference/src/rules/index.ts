/**
 * The registered rule set the engine runs (docs/05 §6.4). Grows unit by unit through
 * G1; each rule is pure and independently testable. Order is irrelevant (rules are
 * independent), except rules that consume other rules' edges read the DB, so a later
 * inference pass sees earlier passes' results — R4/R6 (which build on R1's DEPLOYS_TO)
 * are handled by re-running after R1 persists, or by reading observed/edge state.
 */
import type { Rule } from "../types";
import { repoDeploysToRuntimeRule } from "./r1-deploys";

export const ALL_RULES: readonly Rule[] = [repoDeploysToRuntimeRule];

export { repoDeploysToRuntimeRule } from "./r1-deploys";
