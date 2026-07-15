import { Inject, Injectable } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import { PG_POOL } from "../core/tokens";
import type { SearchProvider, SearchQuery, SearchResponse, SearchResult } from "./search.provider";

/**
 * Postgres-backed search (docs/11 SE-1: a projection of `nodes`, no separate index).
 * Keyword/identifier matching via `pg_trgm` similarity + substring over name/urn/attributes
 * - strong for the exact tokens engineers type (ARNs, `prod-orders`). Org-scoped (RLS,
 * SE-4). Semantic (vector) ranking arrives with the OpenSearch driver; `semantic` is null.
 */
@Injectable()
export class PostgresSearchProvider implements SearchProvider {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  async search(orgId: string, query: SearchQuery): Promise<SearchResponse> {
    const like = `%${query.q}%`;
    const prefix = `${query.q}%`;
    return withOrgScope(this.db, orgId, async (c) => {
      // $1 = raw query (exact/trigram), $2 = %q% (substring), $3 = q% (prefix).
      const params: unknown[] = [query.q, like, prefix];
      let kindFilter = "";
      if (query.kind) kindFilter = ` AND kind = $${params.push(query.kind)}`;

      // Relevance ramp: an exact name outranks a prefix, which outranks a mid-name substring, then a
      // urn hit, then a fuzzy trigram near-miss, then an attribute-only hit. Typing a full resource
      // name now lands it at the top instead of tying with every substring match at ~0.6.
      const { rows } = await c.query<{
        id: string;
        kind: string;
        name: string | null;
        score: string;
      }>(
        `SELECT id, kind, name,
                GREATEST(
                  CASE WHEN lower(name) = lower($1) THEN 1.0 ELSE 0 END,
                  CASE WHEN name ILIKE $3 THEN 0.85 ELSE 0 END,
                  CASE WHEN name ILIKE $2 THEN 0.65 ELSE 0 END,
                  CASE WHEN urn ILIKE $2 THEN 0.55 ELSE 0 END,
                  similarity(name, $1),
                  CASE WHEN attributes::text ILIKE $2 THEN 0.3 ELSE 0 END
                ) AS score
           FROM nodes
          WHERE status <> 'deleted'
            AND (name % $1 OR name ILIKE $2 OR urn ILIKE $2 OR attributes::text ILIKE $2)
            ${kindFilter}
          ORDER BY score DESC NULLS LAST, length(coalesce(name, '')) ASC, last_seen DESC
          LIMIT ${query.limit}`,
        params,
      );

      const data: SearchResult[] = rows.map((r) => {
        const score = Number(r.score) || 0;
        return {
          node: { id: r.id, kind: r.kind, name: r.name },
          score,
          match: { keyword: score, semantic: null },
          highlights: highlight(r.name, query.q),
        };
      });
      return { data, page: { nextCursor: null, hasMore: false, limit: query.limit } };
    });
  }
}

/** Minimal keyword highlight: wrap the first case-insensitive match of `q` in the name. */
function highlight(name: string | null, q: string): string[] {
  if (!name) return [];
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return [];
  return [
    `${name.slice(0, idx)}<em>${name.slice(idx, idx + q.length)}</em>${name.slice(idx + q.length)}`,
  ];
}
