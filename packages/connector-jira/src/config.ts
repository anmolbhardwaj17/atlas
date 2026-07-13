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
  /** Reference-driven backfill: specific issue keys to fetch this run regardless of the recency
   *  window/cap — the tickets our PRs reference but that a recent-N crawl would miss. Set per sync by
   *  the API from the graph, so the crawl scales to any backlog (fetch what the code touches). */
  backfillKeys?: string[];
}

/** A Jira issue key: 1–10 upper-alnum project code, a dash, digits. */
const KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;
/** A Jira project key: a leading letter + up to 9 upper-alnum. Enforced so a configured key can't
 *  break out of the `project = "<key>"` JQL literal in the crawl (crawl.ts) — a `"` would inject. */
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** A single valid DNS label — the shape an Atlassian Cloud site slug must take. */
const SITE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Extract the Atlassian Cloud site slug from a bare slug (`acme`) or a `<slug>.atlassian.net` value
 * (with or without scheme/path). STRICT by design: the result is interpolated into
 * `https://<slug>.atlassian.net/…`, so anything other than a clean single label is REJECTED. This
 * closes an SSRF where a `:`/`#`/`/` in `site` relocated the request host — e.g. `169.254.169.254:80#`
 * (`#` opens a URL fragment) reaching cloud instance metadata, or `evil.com#` exfiltrating the Jira
 * Basic-auth credentials off-platform. A bad `site` now throws at config-parse time.
 */
function toSite(raw: string): string {
  const host = (
    raw
      .trim()
      .replace(/^https?:\/\//i, "")
      .split("/")[0] ?? ""
  ).toLowerCase();
  const slug = host.endsWith(".atlassian.net") ? host.slice(0, -".atlassian.net".length) : host;
  if (!SITE_SLUG_RE.test(slug)) {
    throw new Error(
      "jira config: `site` must be an Atlassian Cloud site slug (e.g. `acme` or `acme.atlassian.net`)",
    );
  }
  return slug;
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
        .filter((k) => PROJECT_KEY_RE.test(k)) // charset-validate (JQL-injection guard)
    : [];
  const backfillRaw = config.backfillKeys;
  const backfillKeys = Array.isArray(backfillRaw)
    ? [
        ...new Set(
          backfillRaw
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim().toUpperCase())
            .filter((k) => KEY_RE.test(k)), // valid Jira keys only (drops fake timestamp branches)
        ),
      ].slice(0, 1000)
    : [];
  const out: JiraConfig = { site };
  if (projectKeys.length > 0) out.projectKeys = projectKeys;
  if (backfillKeys.length > 0) out.backfillKeys = backfillKeys;
  return out;
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
