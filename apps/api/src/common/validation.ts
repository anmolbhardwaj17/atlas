import type { z } from "zod";
import { ApiException } from "./errors";

/**
 * Parse a request body against a zod schema (docs/08 §4 — validate at the edge,
 * reject extra fields). On failure throws `400 validation_failed` with per-field
 * issues (docs/08 §11). Use `.strict()` schemas to block mass-assignment (P8).
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join(".") || "(body)",
      issue: issue.message,
    }));
    throw ApiException.validation(details);
  }
  return result.data;
}
