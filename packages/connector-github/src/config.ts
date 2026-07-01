/**
 * GitHub connection config (the non-secret part of `connections.config`, docs/07 §2).
 * The App private key is a C1 secret and lives in the Secrets Broker (resolved via
 * `Connection.secretRef`), NOT here. `appId` + `installationId` identify the App
 * installation Atlas mints short-lived installation tokens for (DD-1, docs/13 §5).
 */
export interface GithubAppConfig {
  /** GitHub App id (numeric). */
  appId: string;
  /** Installation id for this connection's org/repos (numeric). */
  installationId: string;
}

function numericField(config: Record<string, unknown>, key: string): string {
  const raw = config[key];
  const value = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(value)) {
    throw new Error(`GitHub connection requires a numeric ${key} (config.${key}).`);
  }
  return value;
}

export function parseGithubConfig(config: Record<string, unknown>): GithubAppConfig {
  return {
    appId: numericField(config, "appId"),
    installationId: numericField(config, "installationId"),
  };
}
