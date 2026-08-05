import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Prometheus metrics registry (observability, docs/02 §9.4). One process-wide registry with the
 * default Node/process metrics (memory, GC, event-loop lag) plus Atlas's own:
 *  - `http_requests_total` / `http_request_duration_seconds` — request rate, errors, latency, keyed
 *    by method + matched ROUTE PATTERN (never the raw URL — UUIDs would explode label cardinality).
 *  - `atlas_sync_jobs_total` — sync outcomes (succeeded/partial/failed), the ingest health signal.
 *  - `atlas_sync_queue_depth` — pending/active/failed jobs, so a growing backlog is visible.
 *
 * Scraped at `GET /metrics` (MetricsController). No labels carry secrets or per-user identifiers.
 */
@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly httpRequests: Counter<"method" | "route" | "status">;
  private readonly httpDuration: Histogram<"method" | "route" | "status">;
  private readonly syncJobs: Counter<"outcome">;
  private readonly processErrors: Counter<"kind">;
  private readonly queueDepth: Gauge<"state">;

  constructor() {
    this.registry.setDefaultLabels({ service: "atlas-api" });
    collectDefaultMetrics({ register: this.registry });

    this.httpRequests = new Counter({
      name: "http_requests_total",
      help: "Total HTTP requests, by method, matched route and status.",
      labelNames: ["method", "route", "status"],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request latency in seconds, by method, matched route and status.",
      labelNames: ["method", "route", "status"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.syncJobs = new Counter({
      name: "atlas_sync_jobs_total",
      help: "Completed sync jobs, by outcome.",
      labelNames: ["outcome"],
      registers: [this.registry],
    });
    // Crash visibility (deploy-readiness P1). Alert on ANY increase: an uncaught exception means a
    // pod died, and an unhandled rejection means a promise failed silently in the background.
    this.processErrors = new Counter({
      name: "atlas_process_errors_total",
      help: "Process-level errors, by kind (unhandled_rejection | uncaught_exception).",
      labelNames: ["kind"],
      registers: [this.registry],
    });
    this.queueDepth = new Gauge({
      name: "atlas_sync_queue_depth",
      help: "Sync jobs currently in the queue, by state.",
      labelNames: ["state"],
      registers: [this.registry],
    });
  }

  /** Record one completed HTTP request. `route` is the matched pattern (`/orgs/:orgId/…`). */
  recordHttp(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = { method, route: route || "unmatched", status: String(status) };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  /** Record a finished sync job's outcome (mirrors the runner's status). */
  recordSyncJob(outcome: "succeeded" | "partial" | "failed"): void {
    this.syncJobs.inc({ outcome });
  }

  /** Record a process-level error (see observability/crash-handlers.ts). */
  recordProcessError(kind: string): void {
    this.processErrors.inc({ kind });
  }

  /** Publish the current sync-queue depth by state (waiting/active/failed). */
  setQueueDepth(state: string, count: number): void {
    this.queueDepth.set({ state }, count);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
