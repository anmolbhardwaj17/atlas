/**
 * @atlas/connector-github — the GitHub realization of the frozen @atlas/connector-sdk
 * contract (docs/07). Second implementation of the SDK (after AWS), proving P5/NFR-19.
 *
 * I2.1 lays the deterministic foundation: the node-kind catalog (matching db seeds
 * 0008/0009) and the URN grammar. App auth (I2.2), pure parsers + normalize/signals/
 * observedEdges (I2.3), and live discoverers + webhooks + wiring (I2.4) build on it.
 */
export { repoUrn, pullRequestUrn, workflowUrn, teamUrn, userUrn, packageUrn } from "./urn";
export { GITHUB_NODE_KINDS, GITHUB_NODE_KIND_LIST } from "./node-kinds";
export type { GithubNodeKind, GithubKindDescriptor } from "./node-kinds";
