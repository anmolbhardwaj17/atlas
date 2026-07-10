/**
 * Minimal GitHub REST client (docs/07 §10). Bearer-auths with the installation token,
 * follows `Link: rel="next"` pagination, and handles rate limits: on a primary limit
 * (`x-ratelimit-remaining: 0`) it waits until reset; on a secondary limit
 * (`retry-after`) it waits that long; 5xx get bounded backoff. Waits are bounded and
 * the sleeper is injectable for deterministic tests (mirrors AWS DD-4).
 */
export interface GithubRequestOptions {
  params?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

export interface GithubResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface GithubClient {
  request<T>(path: string, opts?: GithubRequestOptions): Promise<GithubResponse<T>>;
  /** Yield items across pages for array endpoints (or a sub-array via `itemsKey`). */
  paginate<T>(path: string, opts?: GithubRequestOptions & { itemsKey?: string }): AsyncIterable<T>;
}

export interface FetchGithubClientDeps {
  token: string;
  baseUrl?: string;
  maxAttempts?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class FetchGithubClient implements GithubClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(deps: FetchGithubClientDeps) {
    this.token = deps.token;
    this.baseUrl = deps.baseUrl ?? "https://api.github.com";
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.maxWaitMs = deps.maxWaitMs ?? 60_000;
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? (() => Date.now());
  }

  async request<T>(path: string, opts: GithubRequestOptions = {}): Promise<GithubResponse<T>> {
    const url = this.resolve(path, opts.params);
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "atlas-connector",
        },
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (res.ok) {
        return { status: res.status, data: (await res.json()) as T, headers: res.headers };
      }
      const waitMs = this.retryWaitMs(res);
      if (waitMs == null || attempt >= this.maxAttempts) {
        throw new Error(`GitHub ${res.status} for ${path}`);
      }
      await this.sleep(waitMs);
    }
  }

  async *paginate<T>(
    path: string,
    opts: GithubRequestOptions & { itemsKey?: string } = {},
  ): AsyncIterable<T> {
    const perPageOpts: GithubRequestOptions = opts.signal ? { signal: opts.signal } : {};
    let url: string | null = this.resolve(path, { per_page: 100, ...opts.params });
    while (url) {
      const res: GithubResponse<unknown> = await this.request(url, perPageOpts);
      const items = opts.itemsKey
        ? ((res.data as Record<string, unknown>)[opts.itemsKey] as T[])
        : (res.data as T[]);
      for (const item of items ?? []) yield item;
      url = nextLink(res.headers.get("link"));
      // The `Link: rel="next"` URL is server-supplied. GitHub keeps pagination on the same host we
      // authenticated to; refuse to follow it off-origin so the auth token can never be sent to a
      // different host (L8 defence-in-depth — closes an SSRF/token-egress path if a response is
      // tampered with).
      if (url && new URL(url).origin !== new URL(this.baseUrl).origin) {
        throw new Error(
          `GitHub pagination tried to leave ${new URL(this.baseUrl).origin}; refused.`,
        );
      }
    }
  }

  private resolve(path: string, params?: Record<string, string | number | undefined>): string {
    if (/^https?:\/\//.test(path)) return path;
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v != null) u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  /** Bounded wait for rate limits / transient 5xx; null → not retryable. */
  private retryWaitMs(res: Response): number | null {
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) return Math.min(this.maxWaitMs, Number(retryAfter) * 1000);
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if ((res.status === 403 || res.status === 429) && remaining === "0" && reset) {
      const waitMs = Number(reset) * 1000 - this.now();
      return Math.max(0, Math.min(this.maxWaitMs, waitMs));
    }
    if (res.status >= 500) return 1000;
    return null;
  }
}

/** Extract the `rel="next"` URL from a Link header, or null. */
export function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (m) return m[1] ?? null;
  }
  return null;
}
