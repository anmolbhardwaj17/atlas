/**
 * Resilience policy (docs/06 §7.2–§7.3, DD-4). AWS SDK v3 adaptive retry handles
 * intra-call throttling; this wraps cross-call coordination and classifies errors so
 * the crawl degrades freshness, never correctness:
 *  - throttling / transient → exponential backoff with full jitter, bounded retries
 *  - access-denied → surfaced to permission detection (not retried here)
 *  - not-found → eventual-consistency, treated as deleted-candidate by the reconciler
 *  - fatal config → fail the scope
 */

export type AwsErrorClass = "throttling" | "transient" | "access-denied" | "not-found" | "fatal";

export function classifyAwsError(err: unknown): AwsErrorClass {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const name = `${e?.name ?? ""} ${e?.Code ?? ""}`;
  const status = e?.$metadata?.httpStatusCode;

  if (/Throttling|RequestLimitExceeded|TooManyRequests|Throttled/i.test(name) || status === 429) {
    return "throttling";
  }
  if (
    /AccessDenied|UnauthorizedOperation|AuthorizationError|Forbidden/i.test(name) ||
    status === 403
  ) {
    return "access-denied";
  }
  if (/NotFound|NoSuch|ResourceNotFoundException/i.test(name) || status === 404) {
    return "not-found";
  }
  if (
    /Timeout|ServiceUnavailable|InternalError|InternalFailure|ECONNRESET|NetworkingError/i.test(
      name,
    )
  ) {
    return "transient";
  }
  if (status != null && status >= 500) return "transient";
  if (status === 503) return "throttling";
  return "fatal";
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for deterministic tests; defaults to real timers / RNG. */
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  signal?: AbortSignal;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying only throttling/transient failures with exponential backoff +
 * full jitter (docs/06 §7.2). Access-denied / not-found / fatal errors propagate
 * immediately — the caller decides (permission report, reconcile, or fail-scope).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 20_000;
  const sleep = options.sleep ?? defaultSleep;
  const rng = options.rng ?? Math.random;

  let attempt = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      return await fn();
    } catch (err) {
      const cls = classifyAwsError(err);
      attempt++;
      if ((cls !== "throttling" && cls !== "transient") || attempt >= maxAttempts) {
        throw err;
      }
      // Full jitter: random delay in [0, min(max, base * 2^attempt)).
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(Math.floor(rng() * ceiling));
    }
  }
}
