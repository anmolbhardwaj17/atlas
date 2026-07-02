/**
 * Constructs a production BitbucketConnector: real fetch REST client resolving the email +
 * API token from the Secrets Broker by `secret_ref` (docs/13 §7). The API/worker wires this
 * into the ConnectorRegistry alongside AWS (I1) and GitHub (I2).
 */
import type { ConnectorLogger, SecretAccessor } from "@atlas/connector-sdk";
import { BitbucketConnector } from "./bitbucket-connector";

export function createBitbucketConnector(opts: {
  secrets: SecretAccessor;
  logger?: ConnectorLogger;
}): BitbucketConnector {
  return new BitbucketConnector({
    secrets: opts.secrets,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}
