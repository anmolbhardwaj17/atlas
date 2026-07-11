/**
 * Minimal Jira Cloud REST client (`<site>.atlassian.net/rest/api/3`). HTTP Basic auth with the
 * Atlassian email + scoped API token (identical to the Bitbucket connector). Jira uses offset
 * pagination (`startAt`/`maxResults`/`total`, or `isLast`) — different from Bitbucket's `next` URL —
 * so `paginate` increments `startAt`. Rate limits (429 + Retry-After) and 5xx get bounded backoff;
 * the sleeper is injectable for deterministic tests. Read-only — never issues writes (P2).
 */
import { fetchWithTimeout } from "@atlas/connector-sdk";

export interface JiraRequestOptions {
  params?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

export interface JiraResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface JiraClient {
  request<T>(path: string, opts?: JiraRequestOptions): Promise<JiraResponse<T>>;
  /** Yield items from an offset-paged list endpoint, reading `values[]` under `valuesKey`. */
  paginate<T>(path: string, valuesKey: string, opts?: JiraRequestOptions): AsyncIterable<T>;
}

export interface FetchJiraClientDeps {
  site: string;
  email: string;
  apiToken: string;
  baseUrl?: string;
  pageSize?: number;
  maxAttempts?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class FetchJiraClient implements JiraClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private readonly pageSize: number;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: FetchJiraClientDeps) {
    const raw = `${deps.email}:${deps.apiToken}`;
    const b64 =
      typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "utf8").toString("base64");
    this.authHeader = `Basic ${b64}`;
    this.baseUrl = deps.baseUrl ?? `https://${deps.site}.atlassian.net/rest/api/3`;
    this.pageSize = deps.pageSize ?? 50;
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.maxWaitMs = deps.maxWaitMs ?? 60_000;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  async request<T>(path: string, opts: JiraRequestOptions = {}): Promise<JiraResponse<T>> {
    const url = this.resolve(path, opts.params);
    for (let attempt = 1; ; attempt++) {
      const res = await fetchWithTimeout(url, {
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
          "User-Agent": "atlas-connector",
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (res.ok) {
        return { status: res.status, data: (await res.json()) as T, headers: res.headers };
      }
      const waitMs = this.retryWaitMs(res);
      if (waitMs == null || attempt >= this.maxAttempts) {
        throw new JiraHttpError(res.status, path);
      }
      await this.sleep(waitMs);
    }
  }

  async *paginate<T>(
    path: string,
    valuesKey: string,
    opts: JiraRequestOptions = {},
  ): AsyncIterable<T> {
    let startAt = 0;
    for (;;) {
      const res = await this.request<Record<string, unknown>>(path, {
        ...opts,
        params: { ...opts.params, startAt, maxResults: this.pageSize },
      });
      const values = (res.data[valuesKey] as T[] | undefined) ?? [];
      for (const item of values) yield item;
      const total = res.data.total;
      startAt += values.length;
      const done =
        values.length === 0 ||
        res.data.isLast === true ||
        (typeof total === "number" && startAt >= total);
      if (done) break;
    }
  }

  private resolve(path: string, params?: Record<string, string | number | undefined>): string {
    const url = path.startsWith("http")
      ? new URL(path)
      : new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
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
export class JiraHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Jira ${status} for ${path}`);
    this.name = "JiraHttpError";
  }
}
