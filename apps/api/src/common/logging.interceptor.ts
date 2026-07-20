import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { Env } from "@atlas/config";
import { ENV } from "../core/tokens";
import { MetricsService } from "../observability/metrics.service";

interface LoggedRequest {
  method: string;
  url: string;
  id?: string;
  /** Fastify's matched route pattern (`/orgs/:orgId/…`) — stable, low-cardinality for metrics. */
  routeOptions?: { url?: string };
  routerPath?: string;
  /** Set by the tenant-scope guard once the org is resolved — org-tags the access log. */
  org?: { id?: string };
}
interface LoggedReply {
  statusCode: number;
}

/** Severity order for LOG_LEVEL gating (a line is emitted only if its level is ≤ the configured one). */
const LEVEL_ORDER: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Structured access logging + request metrics (observability baseline, docs/02 §9.4). Per completed
 * request it (1) emits one JSON line — `{ requestId, method, url, status, durationMs, orgId? }` —
 * gated by `LOG_LEVEL` (an access line is `info`; errors are `error` and always pass a sane level),
 * and (2) records the Prometheus http counter + latency histogram keyed by the MATCHED ROUTE PATTERN
 * (never the raw URL, which carries UUIDs → unbounded cardinality).
 *
 * Only HTTP contexts are handled. No secrets/headers/bodies are logged (SEC-6) — just the request
 * line + outcome, now with the resolved org id for tenant-scoped triage.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly threshold: number;

  constructor(
    private readonly metrics: MetricsService,
    @Inject(ENV) env: Env,
  ) {
    this.threshold = LEVEL_ORDER[env.LOG_LEVEL] ?? LEVEL_ORDER.info ?? 2;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<LoggedRequest>();
    const reply = http.getResponse<LoggedReply>();
    const start = Date.now();

    const finish = (status: number, level: "info" | "error"): void => {
      const durationMs = Date.now() - start;
      const route = req.routeOptions?.url ?? req.routerPath ?? "unmatched";
      this.metrics.recordHttp(req.method, route, status, durationMs / 1000);
      if ((LEVEL_ORDER[level] ?? 2) > this.threshold) return; // suppressed by LOG_LEVEL
      const line = {
        level,
        msg: "request",
        requestId: req.id,
        method: req.method,
        url: req.url,
        status,
        durationMs,
        ...(req.org?.id ? { orgId: req.org.id } : {}),
      };
      // Structured access log to stdout by design (collected by the platform in deploy).
      console.log(JSON.stringify(line));
    };

    return next.handle().pipe(
      tap({
        next: () => finish(reply.statusCode, "info"),
        error: (err: unknown) => {
          const status =
            typeof err === "object" && err !== null && "status" in err
              ? Number((err as { status: unknown }).status)
              : 500;
          finish(Number.isFinite(status) ? status : 500, "error");
        },
      }),
    );
  }
}
