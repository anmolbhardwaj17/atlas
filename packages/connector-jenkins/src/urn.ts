/**
 * Deterministic Jenkins URN construction (docs/05 §2.2, docs/07c). URNs are stable,
 * recomputable identities that make node upsert idempotent (`uq_node_urn`, docs/04).
 *
 * Scheme:  jenkins:<host>:job/<fullName>
 *   job    jenkins:ci.acme.com:job/team/service-deploy
 *
 * The host is the Jenkins server host (lowercased, one connection per server); the job
 * `fullName` is Jenkins's folder-qualified path (e.g. "team/service-deploy"), preserved
 * as-is (job names are case-sensitive) with surrounding slashes trimmed.
 */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return baseUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .toLowerCase();
  }
}

export function jobUrn(baseUrl: string, fullName: string): string {
  const host = hostOf(baseUrl);
  const name = fullName.trim().replace(/^\/+|\/+$/g, "");
  if (!host) throw new Error("jenkins URN: host is required");
  if (!name) throw new Error("jenkins URN: job fullName is required");
  return `jenkins:${host}:job/${name}`;
}
