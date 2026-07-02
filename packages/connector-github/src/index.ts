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
export { GithubConnector } from "./github-connector";
export type { GithubConnectorDeps } from "./github-connector";
export { parseGithubConfig } from "./config";
export type { GithubAppConfig } from "./config";
export { GithubAppTokenProvider, InstallationAuthError, buildAppJwt } from "./auth";
export type { InstallationTokenProvider, InstallationToken, InstallationTokenInput } from "./auth";
export { verifyWebhookSignature, parseWebhookEvent } from "./webhook";
export type { WebhookEventKind, WebhookDescriptor } from "./webhook";
export { REQUIRED_PERMISSIONS, missingPermissions } from "./permissions";
export { GITHUB_MODULES, MODULE_BY_KIND } from "./modules";
export type { GithubModule } from "./modules";
export type { RepositoryPayload } from "./modules/repository";
export type { PullRequestPayload } from "./modules/pull-request";
export type { WorkflowPayload } from "./modules/workflow";
export type { TeamPayload, UserPayload, PackagePayload } from "./modules/nodes";
export { parseCodeowners, classifyOwner, distinctOwners } from "./parsers/codeowners";
export { parseManifest } from "./parsers/manifest";
export { parseWorkflowDeploys } from "./parsers/workflow";
export type { WorkflowDeploys, DeployTarget } from "./parsers/workflow";
export { createGithubConnector } from "./factory";
export { FetchGithubClient, nextLink } from "./github/client";
export type { GithubClient, GithubResponse, GithubRequestOptions } from "./github/client";
export { listInstallationRepos, crawlRepo } from "./github/crawl";
export type { Discovered } from "./github/crawl";
