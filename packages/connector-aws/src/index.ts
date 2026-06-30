/**
 * @atlas/connector-aws — the AWS realization of the frozen @atlas/connector-sdk
 * contract (docs/06). Provider code lives here; core graph/runner code never imports
 * the AWS SDK directly (DD-1, P5/NFR-19).
 *
 * I1.1 lays the deterministic foundation: the node-kind catalog (matching db seed
 * 0008) and the URN grammar. Credentials/verify (I1.2), service discoverers +
 * pure normalize/signals/observedEdges (I1.3), and resilience/wiring (I1.4) build on it.
 */
export { awsUrn } from "./urn";
export type { AwsUrnInput } from "./urn";
export { AWS_NODE_KINDS, AWS_NODE_KIND_LIST, describeKind } from "./node-kinds";
export type { AwsNodeKind, AwsKindDescriptor, AwsScopeKind } from "./node-kinds";
export { AwsConnector } from "./aws-connector";
export type { AwsConnectorDeps } from "./aws-connector";
export { parseAwsConfig, accountFromArn } from "./config";
export type { AwsConnectionConfig } from "./config";
export {
  StsCredentialProvider,
  AssumeRoleError,
  buildSessionName,
  assumeRoleMessage,
} from "./credentials";
export type {
  CredentialProvider,
  AssumedRole,
  AssumeRoleInput,
  AwsTempCredentials,
} from "./credentials";
export { isAccessDenied } from "./permission-probe";
export type { PermissionProbe, ProbeInput } from "./permission-probe";
export { SERVICE_MODULES, MODULE_BY_KIND } from "./services";
export type { ServiceModule, AwsRawPayload } from "./services/module";
export { createAwsConnector } from "./factory";
export { DISCOVERERS, DISCOVERER_BY_SERVICE } from "./discoverers";
export { probeFromDiscoverer, makeRef } from "./aws/discoverer";
export type { Discoverer, CrawlScopeInput, DiscoveredResource } from "./aws/discoverer";
export { withRetry, classifyAwsError } from "./aws/retry";
export type { AwsErrorClass, RetryOptions } from "./aws/retry";
export { clientConfig } from "./aws/client-config";
