import type { z } from "zod";
import { ApiException } from "./errors";

/**
 * Parse a request body/query against a zod schema (docs/08 §4 - validate at the edge,
 * reject extra fields). On failure throws `400 validation_failed` with per-field
 * issues (docs/08 §11). Use `.strict()` schemas to block mass-assignment (P8).
 *
 * `S extends z.ZodTypeAny` + `z.infer<S>` returns the schema's OUTPUT type, so schemas
 * with `.default()`/`.coerce` (input ≠ output) type correctly.
 */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
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
