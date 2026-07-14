/**
 * A tiny in-process TTL cache for expensive, tenant-scoped read aggregates (e.g. the dashboard
 * `summary()`, several full-estate joins across parallel connections). Two properties matter here:
 *
 *  - **Bounded staleness, no cross-process coordination.** An entry lives at most `ttlMs`, so a write
 *    on another instance is reflected within one TTL — no Redis pub/sub or invalidation bus needed.
 *    The window is short (seconds), and a stale count on a dashboard is harmless (P4 shows freshness).
 *  - **Single-flight.** The cached value is the in-flight *promise*, so a burst of concurrent callers
 *    for the same key share one computation — a rush of dashboard loads collapses to a single DB pass,
 *    which also protects the connection pool.
 *
 * A rejected computation is never cached (the entry is dropped so the next call retries). Local
 * writers can `invalidate(key)` to reflect their own mutation immediately on the same instance;
 * cross-instance callers still converge within the TTL.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Return the cached value for `key`, or compute + cache it. Concurrent callers share one compute. */
  async get(key: string, compute: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;

    const value = compute();
    const entry = { at: this.now(), value };
    this.entries.set(key, entry);
    // Never cache a failure: if compute rejects, drop THIS entry (guard against a newer one racing in).
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return value;
  }

  /** Forget one key — a local writer calls this after mutating the underlying data. */
  invalidate(key: string): void {
    this.entries.delete(key);
  }

  /** Forget everything (test hook / global reset). */
  clear(): void {
    this.entries.clear();
  }
}
