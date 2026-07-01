import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Stable, machine-readable error codes (docs/08 §11, AP-5). Clients branch on
 * `code`; HTTP status is aligned. Enum growth is additive (docs/08 §13).
 */
export type ApiErrorCode =
  | "unauthenticated"
  | "token_expired"
  | "insufficient_role"
  | "org_access_denied"
  | "not_found"
  | "validation_failed"
  | "invalid_cursor"
  | "already_exists"
  | "invalid_state_transition"
  | "connection_verification_failed"
  | "rate_limited"
  | "internal_error";

export interface FieldIssue {
  field: string;
  issue: string;
}

/**
 * The one error envelope (docs/08 §11). Carries a stable `code` + optional field
 * `details`; the global filter renders `{ error: { code, message, details?, requestId } }`.
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: FieldIssue[],
  ) {
    super({ code, message, details }, status);
  }

  static notFound(message = "Not found."): ApiException {
    // Cross-tenant ids resolve here too — existence is never leaked (R8/US-12, docs/08 §11).
    return new ApiException(HttpStatus.NOT_FOUND, "not_found", message);
  }
  static insufficientRole(message: string): ApiException {
    return new ApiException(HttpStatus.FORBIDDEN, "insufficient_role", message);
  }
  static orgAccessDenied(message = "No access to this organization."): ApiException {
    return new ApiException(HttpStatus.FORBIDDEN, "org_access_denied", message);
  }
  static validation(details: FieldIssue[], message = "Invalid request."): ApiException {
    return new ApiException(HttpStatus.BAD_REQUEST, "validation_failed", message, details);
  }
  static alreadyExists(message: string): ApiException {
    return new ApiException(HttpStatus.CONFLICT, "already_exists", message);
  }
  static invalidState(message: string): ApiException {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_state_transition", message);
  }
}
