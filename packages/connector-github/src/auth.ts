/**
 * GitHub App authentication (docs/07 §2, DD-1; docs/13 §5). Atlas signs a short-lived
 * App JWT (RS256, ≤10 min) with the App private key, then exchanges it for an
 * INSTALLATION access token scoped to the connection's installation. Installation
 * tokens are ≤1h and minted per crawl — never long-lived user tokens (mirrors AWS
 * AssumeRole: in-memory, short-lived, read-only). The token response also reports the
 * granted permissions, which drives permission detection (permissions.ts).
 */
import { createPrivateKey } from "node:crypto";
import { SignJWT } from "jose";
import { fetchWithTimeout } from "@atlas/connector-sdk";

export interface InstallationToken {
  token: string;
  /** ISO-8601 expiry (≤1h). */
  expiresAt: string | null;
  /** Granted permissions map, e.g. { contents: "read", metadata: "read" }. */
  permissions: Record<string, string>;
  /** "all" | "selected" — which repos the installation covers. */
  repositorySelection: string | null;
}

export interface InstallationTokenInput {
  appId: string;
  installationId: string;
  /** App private key PEM (PKCS#1 or PKCS#8) — resolved from the Secrets Broker. */
  privateKey: string;
  signal?: AbortSignal;
}

/** Abstraction so the connector (and tests) never bind to the HTTP/JWT specifics. */
export interface InstallationTokenProvider {
  getInstallationToken(input: InstallationTokenInput): Promise<InstallationToken>;
}

export class InstallationAuthError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InstallationAuthError";
  }
}

/**
 * Sign the App JWT (docs/07 §2). `iss` = appId, `iat` backdated 60s for clock skew,
 * `exp` = +9 min (< GitHub's 10-min max). Node's `createPrivateKey` accepts both the
 * PKCS#1 key GitHub issues (`BEGIN RSA PRIVATE KEY`) and PKCS#8 (`BEGIN PRIVATE KEY`).
 */
export async function buildAppJwt(
  appId: string,
  privateKeyPem: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  let key;
  try {
    key = createPrivateKey(privateKeyPem);
  } catch (err) {
    throw new InstallationAuthError("The GitHub App private key is invalid or malformed.", err);
  }
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(appId)
    .setIssuedAt(nowSec - 60)
    .setExpirationTime(nowSec + 540)
    .sign(key);
}

export class GithubAppTokenProvider implements InstallationTokenProvider {
  constructor(private readonly baseUrl: string = "https://api.github.com") {}

  async getInstallationToken(input: InstallationTokenInput): Promise<InstallationToken> {
    const appJwt = await buildAppJwt(input.appId, input.privateKey);
    const url = `${this.baseUrl}/app/installations/${input.installationId}/access_tokens`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "atlas-connector",
        },
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (err) {
      throw new InstallationAuthError("Could not reach GitHub to mint an installation token.", err);
    }
    if (!res.ok) {
      const detail = res.status === 404 ? " (installation not found or App not installed)" : "";
      throw new InstallationAuthError(
        `GitHub rejected the installation token request (${res.status})${detail}.`,
      );
    }
    const body = (await res.json()) as {
      token?: string;
      expires_at?: string;
      permissions?: Record<string, string>;
      repository_selection?: string;
    };
    if (!body.token) throw new InstallationAuthError("GitHub returned no installation token.");
    return {
      token: body.token,
      expiresAt: body.expires_at ?? null,
      permissions: body.permissions ?? {},
      repositorySelection: body.repository_selection ?? null,
    };
  }
}
