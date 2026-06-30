/**
 * Constructs a production AwsConnector: real STS credential provider + permission
 * probes derived from the live discoverers. The API/worker wires this into the
 * ConnectorRegistry (replacing the F2 placeholder), passing the Secrets Broker as the
 * SecretAccessor so the External ID is resolved by `secret_ref` (docs/13 §7).
 */
import type { ConnectorLogger, SecretAccessor } from "@atlas/connector-sdk";
import { AwsConnector } from "./aws-connector";
import { StsCredentialProvider } from "./credentials";
import { DISCOVERERS } from "./discoverers";
import { probeFromDiscoverer } from "./aws/discoverer";

export function createAwsConnector(opts: {
  secrets: SecretAccessor;
  logger?: ConnectorLogger;
}): AwsConnector {
  return new AwsConnector({
    credentials: new StsCredentialProvider(),
    secrets: opts.secrets,
    probes: DISCOVERERS.map(probeFromDiscoverer),
    ...(opts.logger ? { logger: opts.logger } : {}),
  });
}
