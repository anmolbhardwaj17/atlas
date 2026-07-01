/**
 * Permission detection (docs/07 §2, mirrors docs/06 §8 for AWS). The installation
 * access-token response reports the granted permissions directly, so — unlike AWS,
 * which probes — we compare the granted set to what the crawl needs and mark the
 * connection `degraded` (not `error`) when a read is missing (P3, FR-1.6). The App
 * is read-only by construction; these are all `read`.
 */

/** GitHub App permission key → the crawl capability it gates. */
export const REQUIRED_PERMISSIONS: ReadonlyArray<{ key: string; why: string }> = [
  { key: "metadata", why: "repository discovery" },
  { key: "contents", why: "workflows / CODEOWNERS / manifests parsing" },
  { key: "pull_requests", why: "PR timeline (what changed)" },
  { key: "actions", why: "GitHub Actions workflow / deploy signals" },
  { key: "members", why: "CODEOWNERS team resolution" },
];

/** A permission counts as granted if it's at least read-level. */
function grantedRead(level: unknown): boolean {
  return level === "read" || level === "write" || level === "admin";
}

/**
 * Given the token's `permissions` map, return the missing required read permissions
 * formatted as e.g. "contents:read" (for the UI / AI caveat, docs/07 §8).
 */
export function missingPermissions(granted: Record<string, unknown> | undefined): string[] {
  const perms = granted ?? {};
  return REQUIRED_PERMISSIONS.filter((p) => !grantedRead(perms[p.key])).map((p) => `${p.key}:read`);
}
