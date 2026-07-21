import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createBullMQQueue, type BullMQQueue } from "./bullmq-queue";

/**
 * BullMQ behavioral proof against a LIVE Redis (the A1 prod-blocker: the durable queue was only
 * config-tested before). Verifies the properties the in-memory dev driver can't: a job survives the
 * enqueue→process hop through Redis, `jobId` dedupes (at-least-once + idempotent), `depth()` reports
 * the backlog, and `close()` DRAINS in-flight work (graceful shutdown, so a deploy doesn't lose a
 * mid-flight sync). Env-gated: skipped without REDIS_URL (e.g. redis://localhost:6379).
 */
const redisUrl = process.env.REDIS_URL;
const suite = redisUrl ? describe : describe.skip;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const qname = (): string => `atlas-test-${randomUUID().slice(0, 8)}`;

suite("BullMQQueue (live Redis)", () => {
  let q: BullMQQueue;

  beforeAll(() => {
    // Fail fast if the URL is bad, rather than each test timing out.
    createBullMQQueue(redisUrl as string);
  });
  afterEach(async () => {
    if (q) await q.close();
  });

  it("delivers an enqueued job to the processor (survives the Redis hop)", async () => {
    q = createBullMQQueue(redisUrl as string);
    const name = qname();
    const seen: string[] = [];
    const done = new Promise<void>((resolve) => {
      q.process<{ id: string }>(name, async (job) => {
        seen.push(job.data.id);
        resolve();
      });
    });
    await q.enqueue(name, { id: "j1" });
    await done;
    expect(seen).toEqual(["j1"]);
  });

  it("dedupes by jobId — the same job enqueued twice runs once (idempotent)", async () => {
    q = createBullMQQueue(redisUrl as string);
    const name = qname();
    let runs = 0;
    q.process(name, async () => {
      runs += 1;
    });
    await q.enqueue(name, { id: "dupe" }, { jobId: "same" });
    await q.enqueue(name, { id: "dupe" }, { jobId: "same" });
    await sleep(400);
    expect(runs).toBe(1);
  });

  it("depth() reports the waiting backlog", async () => {
    q = createBullMQQueue(redisUrl as string);
    const name = qname();
    // Enqueue WITHOUT registering a processor → the job sits waiting in Redis.
    await q.enqueue(name, { id: "w1" });
    await q.enqueue(name, { id: "w2" }, { jobId: "w2" });
    await sleep(100);
    const d = await q.depth();
    expect(d.waiting).toBeGreaterThanOrEqual(2);
  });

  it("close() drains an in-flight job (graceful shutdown, no lost sync)", async () => {
    q = createBullMQQueue(redisUrl as string);
    const name = qname();
    let completed = false;
    q.process(name, async () => {
      await sleep(300); // simulate a sync that's mid-flight when shutdown arrives
      completed = true;
    });
    await q.enqueue(name, { id: "slow" });
    await sleep(80); // let the worker pick it up (now active)
    await q.close(); // BullMQ worker.close() waits for the active job to finish
    expect(completed).toBe(true);
    q = undefined as unknown as BullMQQueue; // already closed; skip afterEach
  });
});
