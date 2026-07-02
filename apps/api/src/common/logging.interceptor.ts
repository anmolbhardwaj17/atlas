import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";

interface LoggedRequest {
  method: string;
  url: string;
  id?: string;
}
interface LoggedReply {
  statusCode: number;
}

/**
 * Structured access logging (observability baseline, docs/02 §9.4). Emits one JSON line per
 * completed request — `{ requestId, method, url, status, durationMs }` — so logs are
 * machine-parseable and correlatable by the `x-request-id` the client also sees (main.ts).
 * Errors are logged with their status too; the error envelope carries the same requestId.
 *
 * Only HTTP contexts are logged (skips anything non-HTTP). No secrets/headers/bodies are
 * logged (SEC-6) — just the request line + outcome.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<LoggedRequest>();
    const reply = http.getResponse<LoggedReply>();
    const start = Date.now();
    const base = { requestId: req.id, method: req.method, url: req.url };

    const emit = (status: number, level: "info" | "error"): void => {
      const line = { level, msg: "request", ...base, status, durationMs: Date.now() - start };
      // Structured access log to stdout by design (collected by the platform in deploy).
      console.log(JSON.stringify(line));
    };

    return next.handle().pipe(
      tap({
        next: () => emit(reply.statusCode, "info"),
        error: (err: unknown) => {
          const status =
            typeof err === "object" && err !== null && "status" in err
              ? Number((err as { status: unknown }).status)
              : 500;
          emit(Number.isFinite(status) ? status : 500, "error");
        },
      }),
    );
  }
}
