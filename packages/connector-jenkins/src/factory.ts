/**
 * Constructs a production JenkinsConnector: a real fetch client resolving the username + API
 * token from the Secrets Broker by `secret_ref` (docs/13 §7). The API/worker wires this into
 * the ConnectorRegistry alongside AWS/GitHub/Bitbucket.
 */
import type { ConnectorLogger, SecretAccessor } from "@atlas/connector-sdk";
import { JenkinsConnector } from "./jenkins-connector";

export function createJenkinsConnector(opts: {
  secrets: SecretAccessor;
  logger?: ConnectorLogger;
}): JenkinsConnector {
  return new JenkinsConnector({
    secrets: opts.secrets,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}
