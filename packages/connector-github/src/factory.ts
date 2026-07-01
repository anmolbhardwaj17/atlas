/**
 * Constructs a production GithubConnector: real App token provider + fetch REST client.
 * The API/worker wires this into the ConnectorRegistry (replacing the F2 placeholder),
 * passing the Secrets Broker as the SecretAccessor so the App private key is resolved
 * by `secret_ref` (docs/13 §7).
 */
import type { ConnectorLogger, SecretAccessor } from "@atlas/connector-sdk";
import { GithubConnector } from "./github-connector";
import { GithubAppTokenProvider } from "./auth";

export function createGithubConnector(opts: {
  secrets: SecretAccessor;
  logger?: ConnectorLogger;
}): GithubConnector {
  return new GithubConnector({
    auth: new GithubAppTokenProvider(),
    secrets: opts.secrets,
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}
