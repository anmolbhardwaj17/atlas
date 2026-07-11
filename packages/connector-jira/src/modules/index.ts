import type { EdgeUpsert, NodeUpsert, Signal } from "@atlas/connector-sdk";
import { projectNode } from "./project";
import { issueNode, issueEdges } from "./issue";

/**
 * Pure raw→graph transforms, one per Jira node kind (mirrors the Bitbucket/GitHub module registries).
 * The connector dispatches on `ResourceRef.kind`. Each is a pure function of the context-enriched
 * payload — deterministic, unit-testable without any network.
 */
export interface JiraModule {
  readonly kind: string;
  normalize(payload: unknown): NodeUpsert;
  extractSignals(payload: unknown): Signal[];
  observedEdges(payload: unknown): EdgeUpsert[];
}

const noSignals = (): Signal[] => [];
const noEdges = (): EdgeUpsert[] => [];

export const JIRA_MODULES: JiraModule[] = [
  {
    kind: "jira.project",
    normalize: projectNode,
    extractSignals: noSignals,
    observedEdges: noEdges,
  },
  {
    kind: "jira.issue",
    normalize: issueNode,
    extractSignals: noSignals,
    observedEdges: issueEdges,
  },
];

export const MODULE_BY_KIND: Map<string, JiraModule> = new Map(
  JIRA_MODULES.map((m) => [m.kind, m]),
);
