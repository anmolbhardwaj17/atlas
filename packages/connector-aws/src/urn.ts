/**
 * Deterministic AWS URN construction (docs/05 §2.2 / §2.3). The URN is the stable,
 * recomputable cross-provider identity that makes node upsert idempotent
 * (`uq_node_urn`, docs/04) and provenance human-readable (P4).
 *
 * Shape: `aws:<scope>:<account>:<type>:<natural-key>` where `<scope>` is the region
 * (region-scoped resources) or the literal `global` (S3/Route53/IAM). Examples:
 *   aws:us-east-1:123456789012:lambda:checkout-processor
 *   aws:global:123456789012:s3:acme-prod-assets
 *
 * Rules honored (docs/05 §2.3): deterministic & time-independent; region+account live
 * in the scope so multi-account (Phase 1) never collides; the natural key is NOT
 * lowercased because some AWS identifiers are case-significant (Lambda function names,
 * DynamoDB table names) — provider/scope/type segments are already lowercase.
 */
import { AWS_NODE_KINDS, type AwsNodeKind } from "./node-kinds";

export interface AwsUrnInput {
  /** 12-digit AWS account id (URN scope component; from STS GetCallerIdentity). */
  account: string;
  /** Region for region-scoped kinds; ignored (and may be omitted) for global kinds. */
  region?: string;
  /** Stable natural key within scope+type (instance id, function name, `cluster/service`, …). */
  naturalKey: string;
}

export function awsUrn(kind: AwsNodeKind, input: AwsUrnInput): string {
  const desc = AWS_NODE_KINDS[kind];
  const account = input.account.trim();
  const naturalKey = input.naturalKey.trim();
  if (!account) throw new Error(`awsUrn(${kind}): account is required`);
  if (!naturalKey) throw new Error(`awsUrn(${kind}): naturalKey is required`);

  let scope: string;
  if (desc.scope === "global") {
    scope = "global";
  } else {
    const region = input.region?.trim();
    if (!region) throw new Error(`awsUrn(${kind}): region is required for a region-scoped kind`);
    scope = region.toLowerCase();
  }

  return `aws:${scope}:${account}:${desc.type}:${naturalKey}`;
}
