import { randomUUID } from "node:crypto";

/**
 * Provider-agnostic job queue (docs/02 §5). Core code depends on this interface, not
 * on BullMQ directly (DD-6 keeps a Temporal/Kafka migration mechanical). Named queue
 * per stage; `jobId` is the idempotency key (at-least-once + dedupe, NFR-6).
 */
export interface Job<T> {
  id: string;
  name: string;
  data: T;
}
export type JobHandler<T> = (job: Job<T>) => Promise<void>;

export interface JobQueue {
  enqueue<T>(name: string, data: T, opts?: { jobId?: string }): Promise<void>;
  process<T>(name: string, handler: JobHandler<T>): void;
  close(): Promise<void>;
}

/**
 * In-memory JobQueue for dev/tests — runs handlers in-process. Idempotent by `jobId`
 * (duplicate ids are dropped). Buffers jobs enqueued before a processor registers so
 * enqueue-then-register also works. `drain()` awaits all triggered handlers (tests).
 */
export class InMemoryQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly pending = new Map<string, Array<Job<unknown>>>();
  private readonly seen = new Set<string>();
  private inflight: Array<Promise<void>> = [];

  async enqueue<T>(name: string, data: T, opts?: { jobId?: string }): Promise<void> {
    const id = opts?.jobId ?? randomUUID();
    if (this.seen.has(id)) return;
    this.seen.add(id);
    const job: Job<unknown> = { id, name, data };
    const handler = this.handlers.get(name);
    if (handler) {
      this.inflight.push(handler(job));
    } else {
      const list = this.pending.get(name) ?? [];
      list.push(job);
      this.pending.set(name, list);
    }
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    const typed = handler as JobHandler<unknown>;
    this.handlers.set(name, typed);
    const queued = this.pending.get(name) ?? [];
    this.pending.delete(name);
    for (const job of queued) this.inflight.push(typed(job));
  }

  async drain(): Promise<void> {
    const current = this.inflight;
    this.inflight = [];
    await Promise.all(current);
  }

  async close(): Promise<void> {
    await this.drain();
  }
}
