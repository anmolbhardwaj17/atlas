/**
 * Builds the common AWS SDK v3 client config from assumed-role creds. Adaptive retry
 * (docs/06 §7.2/DD-4) is enabled for intra-call throttling; `withRetry` adds cross-call
 * coordination. Global services (S3/Route53/IAM) use a fixed region endpoint.
 */
import type { AwsCredentialProvider, CrawlCredentials } from "../credentials";

export interface AwsClientConfig {
  region: string;
  /** Either a frozen identity (static IAM-user keys / a single AssumeRole) or a self-refreshing
   *  provider the SDK re-invokes before the token expires (CX1). `sessionToken` is present for
   *  AssumeRole creds and omitted for static IAM-user keys. */
  credentials:
    | AwsCredentialProvider
    | { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  retryMode: "adaptive";
  maxAttempts: number;
}

export function clientConfig(creds: CrawlCredentials, region: string): AwsClientConfig {
  return {
    region: region === "global" ? "us-east-1" : region,
    // A provider (function) passes straight through so the SDK can refresh mid-crawl (CX1); a static
    // creds object is frozen into an identity (omit an empty sessionToken — the SDK rejects it).
    credentials:
      typeof creds === "function"
        ? creds
        : {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
          },
    retryMode: "adaptive",
    maxAttempts: 5,
  };
}
