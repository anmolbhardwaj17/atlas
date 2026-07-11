/**
 * @atlas/connector-jira — the Jira Cloud realization of the frozen @atlas/connector-sdk contract
 * (Intent Verification, docs/plans/intent-verification.md). Read-only (P2); crawls a site's projects
 * and issues (story / description / subtasks / comments) into `jira.*` nodes — the "intent" side of
 * intent ↔ code ↔ runtime. PR↔issue linking + the coverage judge build on these nodes.
 */
export { projectUrn, issueUrn } from "./urn";
export { parseJiraConfig, parseJiraCredentials } from "./config";
export type { JiraConfig, JiraCredentials } from "./config";
export { JiraConnector } from "./jira-connector";
export type { JiraConnectorDeps } from "./jira-connector";
export { createJiraConnector } from "./factory";
export {
  FetchJiraClient,
  JiraHttpError,
  type JiraClient,
  type JiraResponse,
  type JiraRequestOptions,
} from "./jira/client";
export { JIRA_MODULES, MODULE_BY_KIND, type JiraModule } from "./modules";
export { adfToText, htmlToText } from "./adf";
