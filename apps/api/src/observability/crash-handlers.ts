import { Logger } from "@nestjs/common";

/**
 * Process-level crash visibility (deploy-readiness audit, P1 — "no error tracking").
 *
 * Atlas had no `unhandledRejection` or `uncaughtException` handler anywhere. Since Node 15 the
 * default for an unhandled rejection is to **terminate the process**, so a stray un-awaited promise
 * anywhere in the API or worker killed the container with nothing but Node's own stderr dump: no
 * structured line, no correlation id, no counter, nothing an alert could fire on. In ECS that reads
 * as a task that silently restarted.
 *
 * This is not a replacement for a Sentry-class service — it's the floor: every crash and every
 * near-crash becomes one structured JSON line plus a Prometheus counter you can alert on
 * (`atlas_process_errors_total`). Wiring a hosted error tracker later is additive; point the
 * existing `OTEL_EXPORTER_OTLP_ENDPOINT` at a backend that ingests OTLP, or add its SDK here.
 *
 * Deliberate asymmetry in how the two are treated:
 *
 *  - **unhandledRejection** — log, count, KEEP RUNNING. Overriding Node's default-kill is the whole
 *    point: a rejected promise in one background tick (a best-effort notification post, say) should
 *    not take down a pod that is happily serving traffic. The counter is how you find out it
 *    happened rather than discovering it as a restart loop.
 *  - **uncaughtException** — log, count, then EXIT NON-ZERO. An uncaught throw means the process's
 *    invariants are unknown; continuing risks serving corrupt state, which for a tenant-isolated
 *    product is worse than a restart. The exit is deferred a tick so the log line and the metric
 *    scrape have a chance to flush.
 */

/** Bumped by the handlers; wired to the Prometheus counter by `registerCrashHandlers`. */
export type ErrorCounter = (kind: "unhandled_rejection" | "uncaught_exception") => void;

const logger = new Logger("Process");

/** Guard against double registration (the API boots the same module graph as the worker). */
let registered = false;

export function registerCrashHandlers(count: ErrorCounter): void {
  if (registered) return;
  registered = true;

  process.on("unhandledRejection", (reason: unknown) => {
    count("unhandled_rejection");
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(
      JSON.stringify({
        level: "error",
        msg: "unhandled_rejection",
        error: err.message,
        stack: err.stack,
      }),
    );
    // Deliberately NOT rethrowing: see the class comment. Node's default would exit here.
  });

  process.on("uncaughtException", (err: Error) => {
    count("uncaught_exception");
    logger.error(
      JSON.stringify({
        level: "error",
        msg: "uncaught_exception",
        error: err.message,
        stack: err.stack,
      }),
    );
    // Let the log flush, then die — the orchestrator restarts us with a clean slate.
    setTimeout(() => process.exit(1), 100).unref();
  });
}

/** Test seam: lets a suite re-register handlers on a fresh process-like object. */
export function resetCrashHandlersForTest(): void {
  registered = false;
}
