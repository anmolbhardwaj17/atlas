/**
 * AWS connection config (the non-secret part of `connections.config`, docs/04 §5.2 /
 * docs/13 §7). The External ID is a C1 secret and lives in the Secrets Broker, NOT
 * here (resolved via `Connection.secretRef`). Regions are an explicit allow-list
 * (docs/06 A25) so scan scope/cost is bounded.
 */
export interface AwsConnectionConfig {
  /** ARN of the customer's read-only role Atlas assumes (docs/06 §2, docs/13 §4). */
  roleArn: string;
  /** Region allow-list to crawl (docs/06 A25). Global services are crawled once regardless. */
  regions: string[];
}

const ROLE_ARN_RE = /^arn:aws[a-z-]*:iam::\d{12}:role\/.+$/;

/** Parse + validate `connections.config` for AWS. Throws a human-readable error
 *  (surfaced as a verify failure) when the shape is wrong (docs/06 §2, US-1 negative). */
export function parseAwsConfig(config: Record<string, unknown>): AwsConnectionConfig {
  const roleArn = config.roleArn;
  if (typeof roleArn !== "string" || !ROLE_ARN_RE.test(roleArn.trim())) {
    throw new Error(
      "AWS connection requires a valid IAM role ARN (config.roleArn, e.g. arn:aws:iam::123456789012:role/AtlasReadOnly).",
    );
  }
  const rawRegions = config.regions;
  if (!Array.isArray(rawRegions) || rawRegions.length === 0) {
    throw new Error("AWS connection requires at least one region (config.regions).");
  }
  const regions = rawRegions.map((r) => String(r).trim().toLowerCase()).filter(Boolean);
  if (regions.length === 0) {
    throw new Error("AWS connection requires at least one non-empty region (config.regions).");
  }
  return { roleArn: roleArn.trim(), regions: [...new Set(regions)] };
}

/** Account id is the 5th `:`-delimited field of any AWS ARN (`arn:aws:iam::<acct>:...`). */
export function accountFromArn(arn: string): string | null {
  const account = arn.split(":")[4];
  return account && /^\d{12}$/.test(account) ? account : null;
}
