import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import type { ConnectorLogger } from "@atlas/connector-sdk";
import type { JobHandler, JobQueue, QueueDepth } from "./queue";

/**
 * Production JobQueue on BullMQ/Redis (docs/02 DD-6). One named queue per stage;
 * `jobId` gives idempotent dedupe. Requires a running Redis — wired in deploy (docs/17).
 * The in-memory driver covers dev/test; this adapter is intentionally thin.
 *
 * Resilience defaults (do NOT drop these — without them a worker crash or a thrown handler is a
 * PERMANENTLY lost job, silently): every job gets bounded retries with exponential backoff, and
 * finished/failed job records are trimmed so Redis doesn't grow without bound. A `failed` listener
 * surfaces terminal failures (after the last attempt) to the logger so production failures aren't
 * invisible outside Redis.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1_000 },
};

/**
 * Build a BullMQQueue from a `redis://` / `rediss://` URL. `maxRetriesPerRequest: null` is REQUIRED
 * by BullMQ workers (blocking commands); `rediss:` enables TLS. Keeps BullMQ/ioredis connection
 * details inside this package so the app just passes REDIS_URL.
 */
export function createBullMQQueue(redisUrl: string, logger?: ConnectorLogger): BullMQQueue {
  const u = new URL(redisUrl);
  const connection: ConnectionOptions = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    ...(u.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
  return new BullMQQueue(connection, logger);
}

export class BullMQQueue implements JobQueue {
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(
    private readonly connection: ConnectionOptions,
    private readonly logger?: ConnectorLogger,
  ) {}

  async enqueue<T>(name: string, data: T, opts?: { jobId?: string }): Promise<void> {
    // jobId (when given) dedupes; retries/backoff/cleanup come from the queue's defaultJobOptions.
    await this.queue(name).add(name, data, opts?.jobId ? { jobId: opts.jobId } : undefined);
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.queue(name); // register the Queue object too, so depth() can count this name in a worker-only process
    const worker = new Worker<T>(
      name,
      async (job) => {
        await handler({ id: String(job.id), name, data: job.data });
      },
      {
        connection: this.connection,
        // Seconds an IDLE worker long-polls before re-issuing its blocking read. The default of 5
        // costs ~17k Redis commands/day per worker doing nothing, which matters on a per-command
        // billed Redis (Upstash) and is pure waste on any of them.
        //
        // This does NOT delay job pickup. The worker blocks on `bzpopmin(marker, drainDelay)`, and
        // enqueueing writes that marker — which wakes the blocked client immediately. drainDelay
        // only governs how often an idle worker re-asks when nothing has arrived.
        drainDelay: 30,
        // How often the worker scans for jobs whose lock expired because a worker died mid-job.
        // The default 30s is another ~3k commands/day doing nothing. At our volume (a handful of
        // syncs a day, one worker) a crashed job being reclaimed within 5 minutes instead of 30
        // seconds is not a meaningful difference — and jobs are still reclaimed, just less eagerly.
        stalledInterval: 300_000,
      },
    );
    // Terminal failure (BullMQ retries internally up to `attempts`; this fires on the last one).
    worker.on("failed", (job, err) => {
      this.logger?.error(`job ${name} failed`, {
        jobId: job?.id,
        attempts: job?.attemptsMade,
        error: err?.message,
      });
    });
    // Infra-level worker error (Redis connection, etc.) — distinct from a job throwing.
    worker.on("error", (err) => {
      this.logger?.error(`worker ${name} error`, { error: err.message });
    });
    this.workers.push(worker);
  }

  async depth(): Promise<QueueDepth> {
    const totals: QueueDepth = { waiting: 0, active: 0, failed: 0 };
    for (const q of this.queues.values()) {
      const c = await q.getJobCounts("wait", "active", "failed");
      totals.waiting += c.wait ?? 0;
      totals.active += c.active ?? 0;
      totals.failed += c.failed ?? 0;
    }
    return totals;
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.queues.set(name, q);
    }
    return q;
  }
}
