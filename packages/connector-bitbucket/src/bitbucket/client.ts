/**
 * Minimal Bitbucket Cloud REST client (api.bitbucket.org/2.0, docs/07b). HTTP Basic auth
 * with the Atlassian email + scoped API token; follows Bitbucket's body-based pagination
 * (`{ values, next }` where `next` is a full URL). Rate limits (429 + Retry-After) and 5xx
 * get bounded backoff; the sleeper is injectable for deterministic tests (mirrors the AWS/
 * GitHub clients). Read-only — the connector never issues writes (P2).
 */
export interface BitbucketRequestOptions {
  params?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
}

export interface BitbucketResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface BitbucketClient {
  request<T>(path: string, opts?: BitbucketRequestOptions): Promise<BitbucketResponse<T>>;
  /** Yield `values[]` across pages, following the body's `next` URL. */
  paginate<T>(path: string, opts?: BitbucketRequestOptions): AsyncIterable<T>;
  /** Raw file text at a revision (the `src` endpoint returns text, not JSON). `null` if absent. */
  content(
    workspace: string,
    repoSlug: string,
    revision: string,
    path: string,
  ): Promise<string | null>;
  /** Raw unified diff of a pull request (text, not JSON). `null` if unavailable. */
  diff(workspace: string, repoSlug: string, prId: number | string): Promise<string | null>;
}

export interface FetchBitbucketClientDeps {
  email: string;
  apiToken: string;
  baseUrl?: string;
  maxAttempts?: number;
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface Page<T> {
  values?: T[];
  next?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class FetchBitbucketClient implements BitbucketClient {
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly maxWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: FetchBitbucketClientDeps) {
    // Basic auth: base64("email:token"). btoa is available in Node ≥ 16 / the workers runtime.
    const raw = `${deps.email}:${deps.apiToken}`;
    const b64 =
      typeof btoa === "function" ? btoa(raw) : Buffer.from(raw, "utf8").toString("base64");
    this.authHeader = `Basic ${b64}`;
    this.baseUrl = deps.baseUrl ?? "https://api.bitbucket.org/2.0";
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.maxWaitMs = deps.maxWaitMs ?? 60_000;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  async request<T>(
    path: string,
    opts: BitbucketRequestOptions = {},
  ): Promise<BitbucketResponse<T>> {
    const url = this.resolve(path, opts.params);
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
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
        throw new BitbucketHttpError(res.status, path);
      }
      await this.sleep(waitMs);
    }
  }

  async diff(workspace: string, repoSlug: string, prId: number | string): Promise<string | null> {
    // GET /repositories/{ws}/{repo}/pullrequests/{id}/diff → raw unified diff text (follows
    // Bitbucket's redirect). Best-effort: unavailable/forbidden yields null, never throws.
    const url = this.resolve(`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diff`);
    try {
      const res = await fetch(url, {
        headers: { Authorization: this.authHeader, "User-Agent": "atlas-connector" },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  async content(
    workspace: string,
    repoSlug: string,
    revision: string,
    path: string,
  ): Promise<string | null> {
    // GET /repositories/{ws}/{repo}/src/{revision}/{path} → raw file text (not JSON). Best-effort:
    // a missing file / permission issue yields null, never fails the crawl.
    const url = this.resolve(
      `/repositories/${workspace}/${repoSlug}/src/${encodeURIComponent(revision)}/${path}`,
    );
    try {
      const res = await fetch(url, {
        headers: { Authorization: this.authHeader, "User-Agent": "atlas-connector" },
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  async *paginate<T>(path: string, opts: BitbucketRequestOptions = {}): AsyncIterable<T> {
    // First page via the normal resolver; subsequent pages follow the absolute `next` URL.
    let next: string | undefined = this.resolve(path, opts.params);
    while (next) {
      const res: BitbucketResponse<Page<T>> = await this.requestAbsolute<Page<T>>(
        next,
        opts.signal,
      );
      for (const item of res.data.values ?? []) yield item;
      next = res.data.next;
    }
  }

  /** Request an already-resolved absolute URL (used to follow `next`). */
  private async requestAbsolute<T>(
    url: string,
    signal?: AbortSignal,
  ): Promise<BitbucketResponse<T>> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
          "User-Agent": "atlas-connector",
        },
        ...(signal ? { signal } : {}),
      });
      if (res.ok) {
        return { status: res.status, data: (await res.json()) as T, headers: res.headers };
      }
      const waitMs = this.retryWaitMs(res);
      if (waitMs == null || attempt >= this.maxAttempts) {
        throw new BitbucketHttpError(res.status, url);
      }
      await this.sleep(waitMs);
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

  /** Bounded wait for retryable responses (429/5xx); null = don't retry. */
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

/** A non-retryable HTTP failure carrying the status (verify maps 401/403 → error/degraded). */
export class BitbucketHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Bitbucket ${status} for ${path}`);
    this.name = "BitbucketHttpError";
  }
}
