/**
 * OpenTelemetry tracing bootstrap (observability, docs/02 §9.4). Complements the Prometheus metrics
 * from the observability module with distributed traces — request → Fastify route → pg query spans.
 *
 * OFF BY DEFAULT: the SDK is only constructed and started when `OTEL_EXPORTER_OTLP_ENDPOINT` is set,
 * so dev/CI (no collector) load nothing and pay zero overhead. In a deploy that runs an OTLP
 * collector (AWS ADOT, Tempo, Jaeger, Honeycomb, …) set that env var and spans flow automatically.
 *
 * This module MUST be imported FIRST in `main.ts` (before Nest/pg/fastify are required) so the
 * instrumentations can patch those modules at load time.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: "atlas-api",
    // Reads the endpoint (and any headers) from the standard OTEL_* env vars.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      // `/health*` and `/metrics` are high-frequency infra probes — don't trace them (noise + cost).
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? "";
          return url.startsWith("/health") || url.startsWith("/metrics");
        },
      }),
      new PgInstrumentation(),
      new FastifyInstrumentation(),
    ],
  });
  sdk.start();
  // Flush spans on shutdown so the last requests before a deploy/scale-down aren't lost.
  process.once("SIGTERM", () => void sdk.shutdown().catch(() => undefined));
}
