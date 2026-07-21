// MUST be first: starts OTel tracing (when OTEL_EXPORTER_OTLP_ENDPOINT is set) before pg/bullmq load.
import "./instrumentation";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger, type LogLevel } from "@nestjs/common";
import { loadEnv } from "@atlas/config";
import { AppModule } from "./app.module";

/**
 * Worker entrypoint (docs/02 §5, docs/17 §3.2 — "worker and api share the build, different entry
 * command"). Boots the SAME AppModule as the API but as a HEADLESS application context (no HTTP
 * server): the lifecycle hooks that register the BullMQ sync worker and the schedulers
 * (sync/health/reaper/retention/notifications/digest) run exactly as they do in-process in the API,
 * so the worker consumes the durable Redis queue and can autoscale independently of the API.
 *
 * In a single-process/dev deploy you can run just the API (`main.ts`) — it already runs the worker
 * in-process. In a scaled deploy, run this as a separate task so crawl/inference load doesn't
 * compete with request latency. `enableShutdownHooks` drains in-flight jobs + closes the pool on
 * SIGTERM (BullMQ worker.close() waits for the active job — no lost sync on deploy/scale-down).
 */
const NEST_LOG_LEVELS: Record<string, LogLevel[]> = {
  error: ["error"],
  warn: ["error", "warn"],
  info: ["error", "warn", "log"],
  debug: ["error", "warn", "log", "debug", "verbose"],
};
const nestLogLevels = (level: string): LogLevel[] =>
  NEST_LOG_LEVELS[level] ?? ["error", "warn", "log"];

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: nestLogLevels(env.LOG_LEVEL),
  });
  app.enableShutdownHooks(); // OnApplicationShutdown: drain the queue, close the PG pool
  Logger.log("Atlas worker started (jobs + schedulers, no HTTP).", "WorkerBootstrap");
}

void bootstrap();
