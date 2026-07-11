/**
 * Constructs a production JiraConnector: real fetch REST client resolving the Atlassian email + API
 * token from the Secrets Broker by `secret_ref`. The API/worker wires this into the ConnectorRegistry
 * alongside AWS/GitHub/Bitbucket/Jenkins.
 */
import type { ConnectorLogger, SecretAccessor } from "@atlas/connector-sdk";
import { JiraConnector } from "./jira-connector";

export function createJiraConnector(opts: {
  secrets: SecretAccessor;
  logger?: ConnectorLogger;
}): JiraConnector {
  return new JiraConnector({
    secrets: opts.secrets,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}
