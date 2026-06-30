/**
 * Shared, pure helpers for the service modules: deterministic URN construction for
 * common AWS reference shapes (ARNs, ECR image URIs) and small tag/edge utilities.
 * Kept pure so modules stay fixture-testable.
 */
import type { EdgeUpsert } from "@atlas/connector-sdk";
import { awsUrn } from "../urn";

/** An observed edge (origin is always "observed", docs/05 §4). */
export function observed(
  type: string,
  fromUrn: string,
  toUrn: string,
  attributes?: Record<string, unknown>,
): EdgeUpsert {
  return attributes
    ? { type, fromUrn, toUrn, origin: "observed", attributes }
    : { type, fromUrn, toUrn, origin: "observed" };
}

/** Normalize AWS `Tags: [{Key,Value}]` (or `tags:[{key,value}]`) into a record. */
export function tagsToObject(
  tags: Array<{ Key?: string; Value?: string; key?: string; value?: string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags ?? []) {
    const k = t.Key ?? t.key;
    const v = t.Value ?? t.value;
    if (k != null) out[k] = v ?? "";
  }
  return out;
}

/** Account id from any ARN (`arn:aws:…::<acct>:…`); null when absent. */
export function accountFromArn(arn: string): string | null {
  const acct = arn.split(":")[4];
  return acct && /^\d{12}$/.test(acct) ? acct : null;
}

/** Region from a regional ARN (`arn:aws:svc:<region>:…`); null for global/region-less. */
export function regionFromArn(arn: string): string | null {
  const region = arn.split(":")[3];
  return region ? region : null;
}

/** IAM role URN from a role ARN (`arn:aws:iam::<acct>:role/<path>/<name>`). IAM is global. */
export function roleUrnFromArn(arn: string): string | null {
  const account = accountFromArn(arn);
  const name = arn.split("/").pop();
  if (!account || !name) return null;
  return awsUrn("aws.iam.role", { account, naturalKey: name });
}

/** Lambda function URN from a function ARN (`arn:aws:lambda:<region>:<acct>:function:<name>`). */
export function lambdaUrnFromArn(arn: string): string | null {
  const account = accountFromArn(arn);
  const region = regionFromArn(arn);
  // `function:<name>` is the 6th+ segment; the name is the last colon segment.
  const name = arn.split(":")[6];
  if (!account || !region || !name) return null;
  return awsUrn("aws.lambda.function", { account, region, naturalKey: name });
}

export interface EcrImageRef {
  account: string;
  region: string;
  repository: string;
  tag: string | null;
}

/** Parse an ECR image URI: `<acct>.dkr.ecr.<region>.amazonaws.com/<repo>[:<tag>]`.
 *  Returns null for non-ECR images (e.g. Docker Hub) — those have no ECR node. */
export function parseEcrImage(image: string): EcrImageRef | null {
  const m = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com\/([^:]+)(?::(.+))?$/.exec(image);
  if (!m) return null;
  return {
    account: m[1] as string,
    region: m[2] as string,
    repository: m[3] as string,
    tag: m[4] ?? null,
  };
}
