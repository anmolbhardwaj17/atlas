import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs";

/**
 * Wraps successful controller results in the canonical single-resource envelope
 * `{ data: ... }` (docs/08 §4). Results that are already enveloped (`data`/`error`
 * present, e.g. paginated `{ data, page }`) pass through untouched.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result: unknown) => {
        // No body (e.g. 204 from a void handler) → don't synthesize one.
        if (result === undefined || result === null) return result;
        // Already enveloped (`{ data }` single, `{ data, page }` collection, or `{ error }`).
        if (typeof result === "object" && ("data" in result || "error" in result)) {
          return result;
        }
        return { data: result };
      }),
    );
  }
}
