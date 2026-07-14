import { describe, it, expect, vi } from "vitest";
import { TtlCache } from "./ttl-cache";

describe("TtlCache", () => {
  it("computes once, then serves cached within the TTL", async () => {
    const t = 0;
    const cache = new TtlCache<number>(100, () => t);
    const compute = vi.fn(async () => 42);

    expect(await cache.get("k", compute)).toBe(42);
    expect(await cache.get("k", compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1); // second call was a hit
  });

  it("recomputes once the TTL has elapsed", async () => {
    let t = 0;
    const cache = new TtlCache<number>(100, () => t);
    const compute = vi.fn(async () => t);

    expect(await cache.get("k", compute)).toBe(0);
    t = 150; // past the TTL
    expect(await cache.get("k", compute)).toBe(150);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent callers into one computation", async () => {
    const cache = new TtlCache<number>(1000, () => 0);
    let resolve!: (n: number) => void;
    const compute = vi.fn(() => new Promise<number>((r) => (resolve = r)));

    const a = cache.get("k", compute);
    const b = cache.get("k", compute);
    resolve(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(compute).toHaveBeenCalledTimes(1); // both shared the in-flight promise
  });

  it("never caches a rejection — the next call retries", async () => {
    const cache = new TtlCache<number>(1000, () => 0);
    const compute = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(99);

    await expect(cache.get("k", compute)).rejects.toThrow("boom");
    expect(await cache.get("k", compute)).toBe(99); // retried, not a cached failure
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a recompute for one key only", async () => {
    const t = 0;
    const cache = new TtlCache<string>(1000, () => t);
    await cache.get("a", async () => "a1");
    await cache.get("b", async () => "b1");

    cache.invalidate("a");
    expect(await cache.get("a", async () => "a2")).toBe("a2"); // recomputed
    expect(await cache.get("b", async () => "b2")).toBe("b1"); // still cached
  });

  it("keys by the exact string (tenant isolation is the caller's responsibility)", async () => {
    const cache = new TtlCache<string>(1000, () => 0);
    expect(await cache.get("org-1", async () => "one")).toBe("one");
    expect(await cache.get("org-2", async () => "two")).toBe("two");
    expect(await cache.get("org-1", async () => "CHANGED")).toBe("one"); // org-1 still its own value
  });
});
