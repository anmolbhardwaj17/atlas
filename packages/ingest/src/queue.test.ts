import { describe, it, expect } from "vitest";
import { InMemoryQueue } from "./queue";

describe("InMemoryQueue", () => {
  it("runs a registered handler for enqueued jobs", async () => {
    const q = new InMemoryQueue();
    const seen: string[] = [];
    q.process<{ v: string }>("t", async (job) => {
      seen.push(job.data.v);
    });
    await q.enqueue("t", { v: "a" });
    await q.enqueue("t", { v: "b" });
    await q.drain();
    expect(seen).toEqual(["a", "b"]);
  });

  it("dedupes by jobId (idempotent)", async () => {
    const q = new InMemoryQueue();
    let count = 0;
    q.process("t", async () => {
      count++;
    });
    await q.enqueue("t", {}, { jobId: "same" });
    await q.enqueue("t", {}, { jobId: "same" });
    await q.drain();
    expect(count).toBe(1);
  });

  it("buffers jobs enqueued before a processor registers", async () => {
    const q = new InMemoryQueue();
    const seen: string[] = [];
    await q.enqueue("t", { v: "early" });
    q.process<{ v: string }>("t", async (job) => {
      seen.push(job.data.v);
    });
    await q.drain();
    expect(seen).toEqual(["early"]);
  });
});
