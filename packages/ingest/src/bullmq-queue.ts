import { Queue, Worker, type ConnectionOptions } from "bullmq";
import type { JobHandler, JobQueue } from "./queue";

/**
 * Production JobQueue on BullMQ/Redis (docs/02 DD-6). One named queue per stage;
 * `jobId` gives idempotent dedupe; BullMQ supplies retries/backoff/rate-limiting.
 * Requires a running Redis — wired in deploy (docs/17). The in-memory driver covers
 * dev/test; this adapter is intentionally thin.
 */
export class BullMQQueue implements JobQueue {
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(private readonly connection: ConnectionOptions) {}

  async enqueue<T>(name: string, data: T, opts?: { jobId?: string }): Promise<void> {
    await this.queue(name).add(name, data, opts?.jobId ? { jobId: opts.jobId } : undefined);
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    const worker = new Worker<T>(
      name,
      async (job) => {
        await handler({ id: String(job.id), name, data: job.data });
      },
      { connection: this.connection },
    );
    this.workers.push(worker);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }
}
