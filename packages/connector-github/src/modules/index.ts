/**
 * Module registry (docs/07 §3). The connector dispatches the pure transforms by node
 * kind. Adding an entity is a one-line registration + module (additive).
 */
import type { GithubModule } from "./module";
import { repositoryModule } from "./repository";
import { pullRequestModule } from "./pull-request";
import { workflowModule } from "./workflow";
import { teamModule, userModule, packageModule } from "./nodes";

export const GITHUB_MODULES: ReadonlyArray<GithubModule> = [
  repositoryModule,
  pullRequestModule,
  workflowModule,
  teamModule,
  userModule,
  packageModule,
];

export const MODULE_BY_KIND: ReadonlyMap<string, GithubModule> = new Map(
  GITHUB_MODULES.map((m) => [m.kind, m]),
);

export type { GithubModule } from "./module";
export { repositoryModule } from "./repository";
export { pullRequestModule } from "./pull-request";
export { workflowModule } from "./workflow";
export { teamModule, userModule, packageModule } from "./nodes";
