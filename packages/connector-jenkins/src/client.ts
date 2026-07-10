/**
 * Minimal Jenkins REST client (docs/07c). HTTP Basic auth with a username + API token;
 * Jenkins exposes JSON via the `/api/json` tree API and config as XML at `.../config.xml`.
 * 429/5xx get bounded backoff; the sleeper is injectable for deterministic tests (mirrors
 * the AWS/GitHub/Bitbucket clients). Read-only — the connector never issues writes (P2).
 */
import { assertResolvesToPublic } from "./ssrf-guard";

export interface JenkinsClient {
  /** GET a JSON endpoint (path relative to the Jenkins root, e.g. "/api/json?tree=..."). */
  json<T>(path: string, signal?: AbortSignal): Promise<T>;
  /** GET raw text (e.g. a job's config.xml); `null` on any non-OK / error (best-effort). */
  text(path: string, signal?: AbortSignal): Promise<string | null>;
}

export interface FetchJenkinsClientDeps {
  baseUrl: string;
  username: string;
  apiToken: string;
  maxAttempts?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class FetchJenkinsClient implements JenkinsClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  /** The base URL's host, re-checked against private ranges before every request (SSRF, H1). */
  private readonly host: string;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: FetchJenkinsClientDeps) {
    const raw = `${deps.username}:${deps.apiToken}`;
    const b64 =
      typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "utf8").toString("base64");
    this.authHeader = `Basic ${b64}`;
    this.baseUrl = deps.baseUrl.replace(/\/+$/, "");
    this.host = new URL(this.baseUrl).hostname;
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.maxWaitMs = deps.maxWaitMs ?? 60_000;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  async json<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = this.resolve(path);
    await assertResolvesToPublic(this.host); // SSRF re-check post-DNS at fetch time (H1)
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
          "User-Agent": "atlas-connector",
        },
        ...(signal ? { signal } : {}),
      });
      if (res.ok) return (await res.json()) as T;
      const waitMs = this.retryWaitMs(res);
      if (waitMs == null || attempt >= this.maxAttempts) {
        throw new JenkinsHttpError(res.status, path);
      }
      await this.sleep(waitMs);
    }
  }

  async text(path: string, signal?: AbortSignal): Promise<string | null> {
    const url = this.resolve(path);
    // SSRF check is OUTSIDE the try so a blocked host propagates — the try only swallows transient
    // fetch/parse failures into a best-effort null, never a security refusal (H1).
    await assertResolvesToPublic(this.host);
    try {
      const res = await fetch(url, {
        headers: { Authorization: this.authHeader, "User-Agent": "atlas-connector" },
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  /** Join a RELATIVE path to the anchored base URL. The absolute-URL passthrough was removed (H1):
   *  every path the crawler passes is already relative (it uses only the *pathname* of any
   *  server-supplied job URL), so accepting `http…` here only ever opened an SSRF bypass. */
  private resolve(path: string): string {
    return this.baseUrl + (path.startsWith("/") ? path : `/${path}`);
  }

  private retryWaitMs(res: Response): number | null {
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const ms = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000;
      return Math.min(ms, this.maxWaitMs);
    }
    if (res.status >= 500) return Math.min(1000, this.maxWaitMs);
    return null;
  }
}

/** A non-retryable HTTP failure carrying the status (verify maps 401/403 → error). */
export class JenkinsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Jenkins ${status} for ${path}`);
    this.name = "JenkinsHttpError";
  }
}
