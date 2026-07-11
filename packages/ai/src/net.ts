/**
 * Outbound HTTP with a deadline, for LLM providers. Unlike connector calls (short, 30s), a
 * completion can legitimately stream for a while, so the default is generous (5 min) — enough for a
 * long answer, but bounded so a dead socket can't hang an SSE request forever. Combined with the
 * caller's cancel signal via `AbortSignal.any` (the user aborting the stream still wins).
 */
export function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = 300_000,
): Promise<Response> {
  const signals: AbortSignal[] = [AbortSignal.timeout(timeoutMs)];
  if (init.signal) signals.push(init.signal);
  return fetch(url, { ...init, signal: AbortSignal.any(signals) });
}

/** A `typeof fetch` default that applies the deadline; providers accept an injected `fetchImpl`
 *  (tests pass their own, so they're unaffected). */
export const timeoutFetch: typeof fetch = (input, init) =>
  fetchWithTimeout(input as string | URL, (init ?? {}) as RequestInit);
