import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import { repositoryNode, repositorySignals, repositoryEdges } from "./repository";
import { pipelineNode, pipelineSignals, pipelineEdges } from "./pipeline";
import { pullRequestNode, pullRequestSignals, pullRequestEdges } from "./pull-request";
import { projectNode, userNode, noSignals, noEdges } from "./nodes";

/**
 * Pure raw→graph transforms, one per Bitbucket node kind (mirrors the GitHub connector's
 * module registry). The connector dispatches on `ResourceRef.kind`. Each is a pure function
 * of the (context-enriched) payload — deterministic, unit-testable without any network.
 */
export interface BitbucketModule {
  readonly kind: string;
  normalize(payload: unknown): NodeUpsert;
  extractSignals(payload: unknown): Signal[];
  observedEdges(payload: unknown): EdgeUpsert[];
}

export const BITBUCKET_MODULES: BitbucketModule[] = [
  {
    kind: "bitbucket.project",
    normalize: projectNode,
    extractSignals: noSignals,
    observedEdges: noEdges,
  },
  {
    kind: "bitbucket.repository",
    normalize: repositoryNode,
    extractSignals: repositorySignals,
    observedEdges: repositoryEdges,
  },
  {
    kind: "bitbucket.pipeline",
    normalize: pipelineNode,
    extractSignals: pipelineSignals,
    observedEdges: pipelineEdges,
  },
  {
    kind: "bitbucket.pullrequest",
    normalize: pullRequestNode,
    extractSignals: pullRequestSignals,
    observedEdges: pullRequestEdges,
  },
  {
    kind: "bitbucket.user",
    normalize: userNode,
    extractSignals: noSignals,
    observedEdges: noEdges,
  },
];

export const MODULE_BY_KIND: Map<string, BitbucketModule> = new Map(
  BITBUCKET_MODULES.map((m) => [m.kind, m]),
);
