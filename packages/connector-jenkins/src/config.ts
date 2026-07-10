/**
 * Non-secret Jenkins connection config (docs/07c). `baseUrl` is the Jenkins server root
 * (e.g. https://ci.acme.com) — it scopes the crawl and anchors every URN. Credentials
 * (username + API token) are NOT here; they live in the Secrets Broker, resolved by
 * `secretRef` at call time (BR-CONN-1, docs/13 §7). Read-only by construction (P2): the
 * connector only ever GETs.
 */
import { assertHostAllowed } from "./ssrf-guard";

export interface JenkinsConfig {
  /** Jenkins server root URL, no trailing slash. */
  baseUrl: string;
}

export function parseJenkinsConfig(config: Record<string, unknown>): JenkinsConfig {
  const raw = config.baseUrl;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("jenkins config: `baseUrl` is required (the Jenkins server URL)");
  }
  // Default to https:// when the user pastes a bare host (e.g. "jenkins.app.siemba.com").
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("jenkins config: `baseUrl` must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("jenkins config: `baseUrl` must be http(s)");
  }
  // SSRF guard (security sweep H1): the baseUrl is tenant-supplied and the connector reaches it with
  // Atlas credentials, so refuse a literal private/loopback/link-local host at save time. A public
  // hostname that *resolves* to an internal IP is caught later, per-request, in the client.
  assertHostAllowed(url.hostname);
  // Normalize: drop a trailing slash so path joins are predictable.
  return { baseUrl: url.toString().replace(/\/+$/, "") };
}

/** Credential shape resolved from the Secrets Broker for HTTP Basic auth. */
export interface JenkinsCredentials {
  /** Jenkins username (the Basic-auth user). */
  username: string;
  /** The user's API token (the Basic-auth password) — read-only user (Overall/Read, Job/Read). */
  apiToken: string;
}

export function parseJenkinsCredentials(secret: Record<string, string>): JenkinsCredentials {
  const username = (secret.username ?? secret.user ?? "").trim();
  const apiToken = (secret.apiToken ?? secret.token ?? "").trim();
  if (!username) throw new Error("jenkins credentials: `username` is missing");
  if (!apiToken) throw new Error("jenkins credentials: `apiToken` is missing");
  return { username, apiToken };
}
