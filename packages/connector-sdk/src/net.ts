/**
 * Outbound HTTP with a hard deadline. Every provider fetch (Bitbucket/GitHub/Jenkins/OSV/…) runs
 * inside the sync worker, often holding an open per-scope DB transaction — a silently-hung socket
 * would stall the worker (and its transaction) indefinitely, and the connectors' retry loops never
 * fire on a hang (only on a thrown error / non-2xx). This wraps `fetch` so a stuck request aborts
 * after `timeoutMs` (default 30s) and surfaces as a normal rejection the caller can retry or fail.
 *
 * The timeout is combined with any caller signal (the crawl's cancel signal, or `init.signal`) via
 * `AbortSignal.any`, so cancellation still works and whichever fires first wins.
 */
export interface FetchTimeoutOptions {
  /** Hard deadline in ms (default 30_000). Pass a larger value for legitimately long calls. */
  timeoutMs?: number;
  /** Additional caller signal (e.g. the crawl cancel signal), combined with the timeout. */
  signal?: AbortSignal;
}

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  opts: FetchTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (init.signal) signals.push(init.signal);
  if (opts.signal) signals.push(opts.signal);
  // `AbortSignal.any` over a single-element array is fine — whichever signal fires first wins.
  return fetch(url, { ...init, signal: AbortSignal.any(signals) });
}
