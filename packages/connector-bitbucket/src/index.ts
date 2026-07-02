/**
 * @atlas/connector-bitbucket — the Bitbucket realization of the frozen @atlas/connector-sdk
 * contract (docs/07b). Third implementation of the SDK (after AWS + GitHub), proving the
 * provider-agnostic abstraction (P5/NFR-19). Read-only (P2); crawls a workspace's projects,
 * members, repositories, deployment environments (pipelines), and open pull requests.
 */
export { projectUrn, repositoryUrn, pipelineUrn, pullRequestUrn, userUrn } from "./urn";
export { parseBitbucketConfig, parseBitbucketCredentials } from "./config";
export type { BitbucketConfig, BitbucketCredentials } from "./config";
export { BitbucketConnector } from "./bitbucket-connector";
export type { BitbucketConnectorDeps } from "./bitbucket-connector";
export { createBitbucketConnector } from "./factory";
export {
  FetchBitbucketClient,
  BitbucketHttpError,
  type BitbucketClient,
  type BitbucketResponse,
  type BitbucketRequestOptions,
} from "./bitbucket/client";
export { BITBUCKET_MODULES, MODULE_BY_KIND, type BitbucketModule } from "./modules";
export {
  resolveWorkspace,
  listRepoSlugs,
  discoverProjects,
  discoverMembers,
  discoverRepo,
  type Discovered,
} from "./bitbucket/crawl";
