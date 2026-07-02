/**
 * Non-secret Bitbucket connection config (docs/07b). The workspace slug scopes the crawl;
 * it's optional — if absent, the connector discovers the workspaces the token can see and
 * uses the first (or all). Credentials (email + API token) are NOT here — they live in the
 * Secrets Broker, resolved by `secretRef` at call time (BR-CONN-1, SEC-6).
 */
export interface BitbucketConfig {
  /** Bitbucket workspace slug (the `bitbucket.org/<workspace>` id). Optional. */
  workspace?: string;
}

export function parseBitbucketConfig(config: Record<string, unknown>): BitbucketConfig {
  const ws = config.workspace;
  if (ws !== undefined && typeof ws !== "string") {
    throw new Error("bitbucket config: `workspace` must be a string");
  }
  const trimmed = typeof ws === "string" ? ws.trim() : "";
  return trimmed ? { workspace: trimmed } : {};
}

/** Credential shape resolved from the Secrets Broker for HTTP Basic auth. */
export interface BitbucketCredentials {
  /** Atlassian account email (the username for REST Basic auth). */
  email: string;
  /** Scoped API token (the password for REST Basic auth). */
  apiToken: string;
}

export function parseBitbucketCredentials(secret: Record<string, string>): BitbucketCredentials {
  const email = (secret.email ?? "").trim();
  const apiToken = (secret.apiToken ?? secret.token ?? "").trim();
  if (!email) throw new Error("bitbucket credentials: `email` is missing");
  if (!apiToken) throw new Error("bitbucket credentials: `apiToken` is missing");
  return { email, apiToken };
}
