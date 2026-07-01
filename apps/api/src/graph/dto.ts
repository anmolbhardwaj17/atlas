import { z } from "zod";
import { ApiException } from "../common/errors";

/** A graph node as returned by the read API (docs/08 §9). */
export interface NodeDto {
  id: string;
  urn: string;
  kind: string;
  name: string | null;
  provider: string;
  region: string | null;
  status: string;
  confidence: string;
  attributes: Record<string, unknown>;
  tags: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
}

export interface NodeRowish {
  id: string;
  urn: string;
  kind: string;
  name: string | null;
  provider: string;
  region: string | null;
  status: string;
  confidence: string;
  attributes: Record<string, unknown>;
  tags: Record<string, unknown>;
  first_seen: Date;
  last_seen: Date;
}

export function toNodeDto(row: NodeRowish): NodeDto {
  return {
    id: row.id,
    urn: row.urn,
    kind: row.kind,
    name: row.name,
    provider: row.provider,
    region: row.region,
    status: row.status,
    confidence: row.confidence,
    attributes: row.attributes ?? {},
    tags: row.tags ?? {},
    firstSeen: row.first_seen.toISOString(),
    lastSeen: row.last_seen.toISOString(),
  };
}

/** Node-list filters + keyset pagination (docs/08 §5). */
export const NodeListQuerySchema = z
  .object({
    kind: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    status: z.enum(["active", "stale", "deleted"]).optional(),
    confidence: z.enum(["observed", "inferred-high", "inferred-low"]).optional(),
    q: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type NodeListQuery = z.infer<typeof NodeListQuerySchema>;

export const EdgesQuerySchema = z
  .object({
    direction: z.enum(["in", "out", "both"]).default("both"),
    type: z.string().min(1).optional(),
    confidence: z.enum(["observed", "inferred-high", "inferred-low"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
export type EdgesQuery = z.infer<typeof EdgesQuerySchema>;

export const NeighborsQuerySchema = z
  .object({ nodeBudget: z.coerce.number().int().min(1).max(500).default(100) })
  .strict();
export type NeighborsQuery = z.infer<typeof NeighborsQuerySchema>;

/** Opaque keyset cursor over (last_seen desc, id desc) — stable under concurrent writes. */
export interface NodeCursor {
  lastSeen: string;
  id: string;
}
export function encodeCursor(c: NodeCursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}
export function decodeCursor(raw: string): NodeCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as NodeCursor;
    if (typeof parsed.lastSeen !== "string" || typeof parsed.id !== "string") throw new Error();
    return parsed;
  } catch {
    throw new ApiException(400, "invalid_cursor", "The pagination cursor is invalid.");
  }
}
