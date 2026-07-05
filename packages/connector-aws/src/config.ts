/**
 * AWS connection config (the non-secret part of `connections.config`, docs/04 §5.2 /
 * docs/13 §7). The External ID is a C1 secret and lives in the Secrets Broker, NOT
 * here (resolved via `Connection.secretRef`). Regions are an explicit allow-list
 * (docs/06 A25) so scan scope/cost is bounded.
 */
export interface AwsConnectionConfig {
  /** How Atlas authenticates to this account: assume a read-only role (recommended, docs/06 §2,
   *  docs/13 §4) or static IAM-user access keys (simpler; long-lived, less secure). */
  authMode: "role" | "keys";
  /** ARN of the customer's read-only role Atlas assumes — present only in `role` mode. */
  roleArn?: string;
  /** Region allow-list to crawl (docs/06 A25). Global services are crawled once regardless. */
  regions: string[];
}

const ROLE_ARN_RE = /^arn:aws[a-z-]*:iam::\d{12}:role\/.+$/;

function parseRegions(config: Record<string, unknown>): string[] {
  const rawRegions = config.regions;
  if (!Array.isArray(rawRegions) || rawRegions.length === 0) {
    throw new Error("AWS connection requires at least one region (config.regions).");
  }
  const regions = rawRegions.map((r) => String(r).trim().toLowerCase()).filter(Boolean);
  if (regions.length === 0) {
    throw new Error("AWS connection requires at least one non-empty region (config.regions).");
  }
  return [...new Set(regions)];
}

/**
 * Parse + validate `connections.config` for AWS. Two auth modes (docs/06 §2, US-1 negative):
 * - `role`  — a valid `config.roleArn` is present → Atlas assumes it (External ID is the secret).
 * - `keys`  — no roleArn → static IAM-user access keys (the keys themselves are the secret).
 * The mode is inferred from whether a roleArn is supplied, so existing role connections are
 * unchanged and a keys connection just omits it. Throws a human-readable error on a bad shape.
 */
export function parseAwsConfig(config: Record<string, unknown>): AwsConnectionConfig {
  const regions = parseRegions(config);
  const rawRole = config.roleArn;
  const hasRole = typeof rawRole === "string" && rawRole.trim().length > 0;
  const explicitKeys = config.authMode === "keys";

  if (hasRole && !explicitKeys) {
    if (!ROLE_ARN_RE.test((rawRole as string).trim())) {
      throw new Error(
        "AWS connection requires a valid IAM role ARN (config.roleArn, e.g. arn:aws:iam::123456789012:role/AtlasReadOnly).",
      );
    }
    return { authMode: "role", roleArn: (rawRole as string).trim(), regions };
  }
  return { authMode: "keys", regions };
}

/** Account id is the 5th `:`-delimited field of any AWS ARN (`arn:aws:iam::<acct>:...`). */
export function accountFromArn(arn: string): string | null {
  const account = arn.split(":")[4];
  return account && /^\d{12}$/.test(account) ? account : null;
}
