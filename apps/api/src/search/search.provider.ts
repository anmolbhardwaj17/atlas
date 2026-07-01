import { z } from "zod";

/**
 * Search abstraction (docs/11 DD-1 impl note). One hybrid engine serves both the human
 * (⌘K) and the AI (entity resolution, docs/10 §4.2). The Postgres impl ships first;
 * the OpenSearch (BM25 + kNN) driver is a swap-in at deploy — same contract.
 */
export const SEARCH_PROVIDER = Symbol("ATLAS_SEARCH_PROVIDER");

export const SearchQuerySchema = z
  .object({
    q: z.string().min(1).max(200),
    kind: z.string().min(1).optional(),
    /** Accepted for forward-compat; MVP (Postgres) is keyword-only (semantic = null). */
    type: z.enum(["hybrid", "keyword", "semantic"]).default("hybrid"),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export interface SearchResult {
  node: { id: string; kind: string; name: string | null };
  score: number;
  /** Per-signal scores; `semantic` is null until the vector index exists (docs/11). */
  match: { keyword: number; semantic: number | null };
  highlights: string[];
}

export interface SearchResponse {
  data: SearchResult[];
  page: { nextCursor: null; hasMore: boolean; limit: number };
}

export interface SearchProvider {
  search(orgId: string, query: SearchQuery): Promise<SearchResponse>;
}
