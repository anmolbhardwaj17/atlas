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

/** A comma-separated multi-value facet ("aws,github"), whitelisted to `allowed` when given. Empty
 *  after filtering → undefined (treated as "no filter"). Powers multi-select facets in Explore. */
const csvFacet = (allowed?: readonly string[]) =>
  z
    .string()
    .min(1)
    .transform((s) => {
      const parts = [
        ...new Set(
          s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ];
      return allowed ? parts.filter((x) => (allowed as readonly string[]).includes(x)) : parts;
    })
    .transform((arr) => (arr.length > 0 ? arr : undefined))
    .optional();

/** Node-list filters + keyset pagination (docs/08 §5). Product-facing facets accept multiple
 *  comma-separated values (OR within a facet, AND across facets). */
export const NodeListQuerySchema = z
  .object({
    kind: z.string().min(1).optional(),
    // Product-facing facets: `source` = the connection provider (aws/bitbucket/…);
    // `category` = the semantic node_kinds group (code/compute/data/networking/…). Both multi-value.
    source: csvFacet(),
    category: csvFacet(),
    region: z.string().min(1).optional(),
    status: csvFacet(["active", "stale", "deleted"]),
    confidence: z.enum(["observed", "inferred-high", "inferred-low"]).optional(),
    // Runtime health facet (docs/08 §5). Reads attributes.health.state; 'unknown' = never checked.
    health: csvFacet(["healthy", "degraded", "unhealthy", "unknown"]),
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

/** Traversal (blast-radius / dependencies). Over-limit values are clamped + warned
 *  (never rejected, A21); `edgeTypes` optionally overrides the impact set. */
export const TraversalQuerySchema = z
  .object({
    depth: z.coerce.number().int().min(1).max(50).default(5),
    nodeBudget: z.coerce.number().int().min(1).max(5000).default(500),
    minConfidence: z.enum(["observed", "inferred-high", "inferred-low"]).optional(),
    edgeTypes: z.string().min(1).optional(),
  })
  .strict();
export type TraversalQuery = z.infer<typeof TraversalQuerySchema>;

/** Timeline "what changed since" (docs/08 §10.3, US-5). `kinds` filters node changes. */
export const TimelineQuerySchema = z
  .object({
    since: z.coerce.date(),
    kinds: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type TimelineQuery = z.infer<typeof TimelineQuerySchema>;

/** Whole-graph fetch for the visual map (nodes+edges, bounded, grouped by env/account/region). */
export const GraphQuerySchema = z
  .object({
    environment: z.enum(["prod", "staging", "dev", "test", "unknown"]).optional(),
    account: z.string().min(1).optional(),
    region: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(400),
  })
  .strict();
export type GraphQuery = z.infer<typeof GraphQuerySchema>;

/** A node in the map view: the read DTO plus its (derived) environment + account grouping. */
/** Point-in-time runtime health (operational-intelligence Phase B), from attributes.health. */
export interface NodeHealthDto {
  state: "healthy" | "degraded" | "unhealthy";
  reason?: string;
  checkedAt?: string;
}

export interface GraphNodeDto extends NodeDto {
  environment: string;
  accountRef: string | null;
  health: NodeHealthDto | null;
}

const HEALTH_STATES = new Set(["healthy", "degraded", "unhealthy"]);

/** Extract a valid health annotation from node attributes (unknown/absent → null). */
export function healthFrom(attributes: Record<string, unknown>): NodeHealthDto | null {
  const h = attributes["health"] as
    { state?: unknown; reason?: unknown; checkedAt?: unknown } | undefined;
  if (!h || typeof h.state !== "string" || !HEALTH_STATES.has(h.state)) return null;
  return {
    state: h.state as NodeHealthDto["state"],
    ...(typeof h.reason === "string" ? { reason: h.reason } : {}),
    ...(typeof h.checkedAt === "string" ? { checkedAt: h.checkedAt } : {}),
  };
}

/** Impact-bearing edge types traversed for blast-radius/dependencies (docs/05 §7.2). */
export const IMPACT_EDGE_TYPES = [
  "CONNECTS_TO",
  "DEPENDS_ON",
  "ROUTES_TO",
  "STORES_IN",
  "DEPLOYS_TO",
] as const;

const RANK: Record<string, number> = { observed: 3, "inferred-high": 2, "inferred-low": 1 };
/** Confidence → numeric rank (higher = more trustworthy). */
export function confidenceRank(confidence: string | undefined): number {
  return confidence ? (RANK[confidence] ?? 1) : 1;
}
/** Numeric rank → confidence tier (for pathConfidence = weakest edge, docs/05 §8). */
export function rankToConfidence(rank: number): string {
  return rank >= 3 ? "observed" : rank === 2 ? "inferred-high" : "inferred-low";
}

/** Opaque keyset cursor over (last_seen desc, id desc) - stable under concurrent writes. */
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
