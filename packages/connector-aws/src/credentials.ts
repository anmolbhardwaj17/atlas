/**
 * Credential & AssumeRole flow (docs/06 §2, docs/13 §4). Atlas uses its OWN identity
 * (the worker's task role, via the default AWS credential chain) to `sts:AssumeRole`
 * the customer's read-only role, passing the per-connection External ID
 * (confused-deputy defense) and `sessionName=atlas-…-<id>` so every action is
 * attributable in the CUSTOMER's CloudTrail. The returned creds are ≤1h and held in
 * memory only — never persisted (A23, P8).
 */
import { STSClient, AssumeRoleCommand, type AssumeRoleCommandOutput } from "@aws-sdk/client-sts";
import { accountFromArn } from "./config";

/** Short-lived STS credentials (in-memory only). */
export interface AwsTempCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO-8601 expiry; the SDK refreshes before this during a long sync. */
  expiration: string | null;
}

export interface AssumedRole {
  credentials: AwsTempCredentials;
  /** Customer account id, parsed from the assumed-role ARN (URN scope component). */
  accountId: string;
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
