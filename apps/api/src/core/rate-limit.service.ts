import { Inject, Injectable } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import { PG_POOL } from "./tokens";
import { ApiException } from "../common/errors";

/**
 * Durable, org-scoped fixed-window rate limiter (security sweep H2 + M4). A single atomic upsert per
 * check increments the counter for the current window and returns the new total; over the limit ⇒
 * `429 rate_limited`. Backed by the `rate_limits` table (migration 0039) so limits hold across
 * restarts and multiple API instances — an in-memory limiter would reset on deploy and be per-pod.
 *
 * Why not `@nestjs/throttler`: it's HTTP-guard only (can't cover the WebSocket Ask path, the main AI
 * cost surface) and in-memory by default. Enforcing here — inside the service methods that funnel
 * both transports — protects the actual expensive operation, uniformly.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  /**
   * Count one hit against `(orgId, bucket)` in the current `windowSeconds` window and throw
   * `tooManyRequests` if the window's total would exceed `limit`. The window start is snapped to a
   * fixed grid so all callers in the same window share one counter row (no clock skew between hits).
   * `message` customises the 429 text (e.g. an upsell to add a BYO key). Runs in the org's RLS scope.
   */
  async enforce(
    orgId: string,
    bucket: string,
    limit: number,
    windowSeconds: number,
    message?: string,
  ): Promise<void> {
    const count = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ count: number }>(
        `INSERT INTO rate_limits (org_id, bucket, window_start, count)
         VALUES ($1, $2, to_timestamp(floor(extract(epoch from now()) / $3) * $3), 1)
         ON CONFLICT (org_id, bucket, window_start)
           DO UPDATE SET count = rate_limits.count + 1
         RETURNING count`,
        [orgId, bucket, windowSeconds],
      );
      return rows[0]?.count ?? 1;
    });
    if (count > limit) {
      throw ApiException.tooManyRequests(message);
    }
  }
}
