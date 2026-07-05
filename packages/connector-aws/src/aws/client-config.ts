/**
 * Builds the common AWS SDK v3 client config from assumed-role creds. Adaptive retry
 * (docs/06 §7.2/DD-4) is enabled for intra-call throttling; `withRetry` adds cross-call
 * coordination. Global services (S3/Route53/IAM) use a fixed region endpoint.
 */
import type { AwsTempCredentials } from "../credentials";

export interface AwsClientConfig {
  region: string;
  /** `sessionToken` is present for AssumeRole creds and omitted for static IAM-user keys. */
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  retryMode: "adaptive";
  maxAttempts: number;
}

export function clientConfig(creds: AwsTempCredentials, region: string): AwsClientConfig {
  return {
    region: region === "global" ? "us-east-1" : region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      // Only set sessionToken when present — the SDK rejects an empty token on static keys.
      ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
    },
    retryMode: "adaptive",
    maxAttempts: 5,
  };
}
