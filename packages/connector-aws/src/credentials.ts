/**
 * Credential & AssumeRole flow (docs/06 §2, docs/13 §4). Atlas uses its OWN identity
 * (the worker's task role, via the default AWS credential chain) to `sts:AssumeRole`
 * the customer's read-only role, passing the per-connection External ID
 * (confused-deputy defense) and `sessionName=atlas-…-<id>` so every action is
 * attributable in the CUSTOMER's CloudTrail. The returned creds are ≤1h and held in
 * memory only — never persisted (A23, P8).
 */
import {
  STSClient,
  AssumeRoleCommand,
  GetCallerIdentityCommand,
  type AssumeRoleCommandOutput,
} from "@aws-sdk/client-sts";
import { accountFromArn } from "./config";

/** AWS credentials held in memory for a run. `sessionToken` is present for AssumeRole
 *  (temporary) creds and absent for static IAM-user keys (docs/06 §2). */
export interface AwsTempCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present only for temporary (AssumeRole) credentials; omitted for static IAM-user keys. */
  sessionToken?: string;
  /** ISO-8601 expiry; the SDK refreshes before this during a long sync. Null for static keys. */
  expiration: string | null;
}

export interface AssumedRole {
  credentials: AwsTempCredentials;
  /** Customer account id, parsed from the assumed-role ARN (URN scope component). */
  accountId: string;
}

/**
 * The AWS-SDK-shaped credential identity. Declared structurally (not imported from `@smithy/types`,
 * which is only a transitive dep) so `clientConfig` can hand the SDK a value it accepts either as a
 * static identity or a provider. Structurally assignable to smithy's `AwsCredentialIdentity`.
 */
export interface AwsCredentialIdentity {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** SDK refreshes when within its window of this instant; absent ⇒ never expires (static keys). */
  expiration?: Date;
}

/** A function the AWS SDK calls to (re)resolve credentials — the async provider form (CX1). */
export type AwsCredentialProvider = () => Promise<AwsCredentialIdentity>;

/** What the crawl hands `clientConfig`: static creds, or a self-refreshing provider (CX1). */
export type CrawlCredentials = AwsTempCredentials | AwsCredentialProvider;

const toIdentity = (c: AwsTempCredentials): AwsCredentialIdentity => ({
  accessKeyId: c.accessKeyId,
  secretAccessKey: c.secretAccessKey,
  ...(c.sessionToken ? { sessionToken: c.sessionToken } : {}),
  ...(c.expiration ? { expiration: new Date(c.expiration) } : {}),
});

/**
 * Build a self-refreshing credential provider (CX1). AssumeRole creds live ≤1h, but a full crawl can
 * exceed that — after which every SDK call fails with `ExpiredToken`, which the crawl misread as an
 * access-denied (missing-permission) verdict and never retried → silent data loss + a false "grant
 * these permissions" banner. Handing the SDK a *provider* (not a frozen creds object) lets this
 * memoizer re-`assumeRole` shortly before the token lapses, so a multi-hour crawl degrades freshness,
 * never correctness. Static IAM-user keys carry no expiry, so `refresh` is never called past the seed.
 * Concurrent callers share one in-flight refresh; a refresh failure propagates to the caller.
 */
export function refreshingCredentials(
  refresh: () => Promise<AwsTempCredentials>,
  seed?: AwsTempCredentials,
  options: { refreshWindowMs?: number; now?: () => number } = {},
): AwsCredentialProvider {
  const windowMs = options.refreshWindowMs ?? 5 * 60_000; // refresh 5 min before expiry
  const now = options.now ?? Date.now;
  let cached: AwsTempCredentials | null = seed ?? null;
  let inFlight: Promise<AwsTempCredentials> | null = null;
  const isFresh = (c: AwsTempCredentials): boolean =>
    c.expiration === null ? true : Date.parse(c.expiration) - now() > windowMs;
  return async () => {
    if (cached && isFresh(cached)) return toIdentity(cached);
    if (!inFlight) {
      inFlight = refresh().finally(() => {
        inFlight = null;
      });
    }
    cached = await inFlight;
    return toIdentity(cached);
  };
}

export interface AssumeRoleInput {
  roleArn: string;
  externalId: string;
  sessionName: string;
  signal?: AbortSignal;
}

/** Abstraction so the connector (and its tests) never bind to the STS client directly. */
export interface CredentialProvider {
  assumeRole(input: AssumeRoleInput): Promise<AssumedRole>;
}

/** Thrown when AssumeRole fails (bad ARN, missing/incorrect External ID, role deleted).
 *  Distinguishes auth failures (→ connection `error`) from transient ones. */
export class AssumeRoleError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AssumeRoleError";
  }
}

/** STS sessionName must match [\w+=,.@-]{2,64}. Encode the purpose + a stable id. */
export function buildSessionName(prefix: string, id: string): string {
  const raw = `${prefix}-${id}`.replace(/[^\w+=,.@-]/g, "-");
  return raw.slice(0, 64);
}

export class StsCredentialProvider implements CredentialProvider {
  private readonly client: STSClient;

  constructor(client?: STSClient) {
    // Region is required by the SDK; STS is global but uses a regional endpoint.
    this.client = client ?? new STSClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  }

  async assumeRole(input: AssumeRoleInput): Promise<AssumedRole> {
    let out: AssumeRoleCommandOutput;
    try {
      const command = new AssumeRoleCommand({
        RoleArn: input.roleArn,
        ExternalId: input.externalId,
        RoleSessionName: input.sessionName,
        DurationSeconds: 3600,
      });
      out = input.signal
        ? await this.client.send(command, { abortSignal: input.signal })
        : await this.client.send(command);
    } catch (err) {
      throw new AssumeRoleError(assumeRoleMessage(err), err);
    }

    const c = out.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
      throw new AssumeRoleError("AssumeRole returned no credentials.");
    }
    const accountId =
      accountFromArn(out.AssumedRoleUser?.Arn ?? "") ?? accountFromArn(input.roleArn);
    if (!accountId) {
      throw new AssumeRoleError("Could not determine the AWS account id from the assumed role.");
    }
    return {
      accountId,
      credentials: {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken,
        expiration: c.Expiration ? c.Expiration.toISOString() : null,
      },
    };
  }
}

/**
 * Resolves STATIC IAM-user credentials (access key + secret key) into the same AssumedRole shape
 * the crawl uses. It validates the keys and derives the account id via STS GetCallerIdentity, so
 * downstream discoverers/probes are identical whether creds came from AssumeRole or static keys.
 * Chosen when a connection is configured with access keys instead of an assumable role.
 */
export interface StaticCredentialInput {
  accessKeyId: string;
  secretAccessKey: string;
  signal?: AbortSignal;
}

export interface StaticCredentialResolver {
  resolve(input: StaticCredentialInput): Promise<AssumedRole>;
}

export class StsStaticCredentialResolver implements StaticCredentialResolver {
  constructor(private readonly clientFactory?: (input: StaticCredentialInput) => STSClient) {}

  async resolve(input: StaticCredentialInput): Promise<AssumedRole> {
    const client =
      this.clientFactory?.(input) ??
      new STSClient({
        region: process.env.AWS_REGION ?? "us-east-1",
        credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
      });
    let account: string | undefined;
    try {
      const command = new GetCallerIdentityCommand({});
      const out = input.signal
        ? await client.send(command, { abortSignal: input.signal })
        : await client.send(command);
      account = out.Account;
    } catch (err) {
      throw new AssumeRoleError(staticCredsMessage(err), err);
    } finally {
      client.destroy();
    }
    if (!account || !/^\d{12}$/.test(account)) {
      throw new AssumeRoleError("Could not determine the AWS account id from these credentials.");
    }
    return {
      accountId: account,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        expiration: null,
      },
    };
  }
}

/** Map an STS GetCallerIdentity error to a customer-actionable message for static keys. */
export function staticCredsMessage(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  if (/InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient|AuthFailure/i.test(name)) {
    return "AWS rejected these access keys. Check the Access Key ID and Secret Access Key are correct and still active.";
  }
  if (/AccessDenied/i.test(name)) {
    return "These keys were accepted but lack sts:GetCallerIdentity — attach a read-only policy (e.g. ReadOnlyAccess/SecurityAudit) to the IAM user.";
  }
  const msg = (err as { message?: string })?.message;
  return msg
    ? `Could not validate the AWS access keys: ${msg}`
    : "Could not validate the AWS access keys.";
}

/** Map an STS error to a customer-actionable message (docs/06 §2, US-1 negative). */
export function assumeRoleMessage(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  if (/AccessDenied/i.test(name)) {
    return "AssumeRole was denied. Check the role's trust policy allows Atlas and that the External ID matches.";
  }
  if (/ExpiredToken|InvalidClientTokenId|CredentialsProviderError/i.test(name)) {
    return "Atlas could not authenticate to AWS STS. This is an Atlas-side credential issue.";
  }
  if (/MalformedPolicy|ValidationError|InvalidParameter/i.test(name)) {
    return "The role ARN appears invalid or malformed.";
  }
  const msg = (err as { message?: string })?.message;
  return msg ? `AssumeRole failed: ${msg}` : "AssumeRole failed.";
}
