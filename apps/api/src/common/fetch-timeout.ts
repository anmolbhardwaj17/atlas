/**
 * `fetch()` with a hard deadline. All outbound HTTP from the API (email, notification webhooks,
 * Slack/Discord OAuth + posts) must go through this so a black-holed connection can never hang the
 * caller — a hung webhook would otherwise stall a whole dispatch tick or pin a request forever.
 * Aborts after `timeoutMs` (default 10s) and merges any caller signal with the timeout.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = 10_000, signal, ...rest } = init ?? {};
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return fetch(url, { ...rest, signal: combined });
}
