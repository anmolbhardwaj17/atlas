import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ApiErrorCode, FieldIssue } from "./errors";

/** Minimal Fastify reply/request shapes the filter needs (avoids a direct fastify dep). */
interface HttpReply {
  status(code: number): { send(body: unknown): unknown };
}
interface HttpRequest {
  method: string;
  url: string;
  /** Fastify correlation id (from `x-request-id` or generated) — see main.ts. */
  id?: string;
}

/**
 * The single error envelope (docs/08 §11). Every thrown error becomes
 * `{ error: { code, message, details?, requestId } }` with an HTTP-aligned status.
 * Our `ApiException` carries an explicit `code`; Nest's built-in HttpExceptions
 * (e.g. the auth guard's 401) are mapped to a stable code by status.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<HttpReply>();
    const req = ctx.getRequest<HttpRequest>();
    // Reuse the request-wide correlation id so the error the client sees matches the logs.
    const requestId = req.id ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = "internal_error";
    let message = "Something went wrong.";
    let details: FieldIssue[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === "object" && payload !== null && "code" in payload) {
        // Our ApiException shape.
        const p = payload as { code: ApiErrorCode; message: string; details?: FieldIssue[] };
        code = p.code;
        message = p.message;
        details = p.details;
      } else {
        // Built-in HttpException (e.g. UnauthorizedException) — map status → code.
        code = codeForStatus(status);
        message = extractMessage(payload) ?? exception.message;
      }
    } else {
      this.logger.error(
        `Unhandled exception [${requestId}] on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    void reply.status(status).send({ error: { code, message, details, requestId } });
  }
}

function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return "unauthenticated";
    case HttpStatus.FORBIDDEN:
      return "insufficient_role";
    case HttpStatus.NOT_FOUND:
      return "not_found";
    case HttpStatus.BAD_REQUEST:
      return "validation_failed";
    case HttpStatus.CONFLICT:
      return "already_exists";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "rate_limited";
    default:
      return "internal_error";
  }
}

function extractMessage(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const m = (payload as { message: unknown }).message;
    if (typeof m === "string") return m;
    if (Array.isArray(m) && typeof m[0] === "string") return m[0];
  }
  return null;
}
