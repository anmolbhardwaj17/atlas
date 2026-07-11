/**
 * Non-secret Jira connection config. The `site` is the Atlassian Cloud subdomain
 * (`<site>.atlassian.net`) — required, since it names which instance to crawl. Optional
 * `projectKeys` scopes the crawl to specific projects; absent → all the token can see.
 * Credentials (email + API token) live in the Secrets Broker, resolved by `secretRef` at call time.
 */
export interface JiraConfig {
  /** Atlassian Cloud site subdomain, e.g. `acme` for `acme.atlassian.net`. */
  site: string;
  /** Restrict the crawl to these project keys (e.g. ["ENG","OPS"]); empty = all. */
  projectKeys?: string[];
}

/** Accept a full URL or a bare subdomain and return the site slug. */
function toSite(raw: string): string {
  const v = raw.trim().replace(/^https?:\/\//, "");
  const host = v.split("/")[0] ?? v;
  const m = /^([a-z0-9-]+)\.atlassian\.net$/i.exec(host);
  return (m?.[1] ?? host).trim().toLowerCase();
}

export function parseJiraConfig(config: Record<string, unknown>): JiraConfig {
  const raw = config.site;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("jira config: `site` is required (e.g. acme.atlassian.net)");
  }
  const site = toSite(raw);
  if (!site) throw new Error("jira config: could not parse a site from `site`");
  const keysRaw = config.projectKeys;
  const projectKeys = Array.isArray(keysRaw)
    ? keysRaw
        .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
        .map((k) => k.trim().toUpperCase())
    : [];
  return projectKeys.length > 0 ? { site, projectKeys } : { site };
}

/** Credential shape resolved from the Secrets Broker for HTTP Basic auth (Atlassian). */
export interface JiraCredentials {
  email: string;
  apiToken: string;
}

export function parseJiraCredentials(secret: Record<string, string>): JiraCredentials {
  const email = (secret.email ?? "").trim();
  const apiToken = (secret.apiToken ?? secret.token ?? "").trim();
  if (!email) throw new Error("jira credentials: `email` is missing");
  if (!apiToken) throw new Error("jira credentials: `apiToken` is missing");
  return { email, apiToken };
}
