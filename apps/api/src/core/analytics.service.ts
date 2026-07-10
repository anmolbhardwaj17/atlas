import { Inject, Injectable, Logger } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import { PG_POOL } from "./tokens";

/**
 * Product-analytics event stream (docs/12 §6.3, docs/04). Records the activation funnel —
 * org.created → onboarding.completed → source.connected → first cited answer — into the
 * append-only, org-scoped `analytics_events` table (atlas_app has INSERT+SELECT only).
 *
 * This is analytics about the ACCOUNT (business/product), distinct from the audit log (security)
 * and from the knowledge graph (SEC-10 minimization governs ingested customer infra, not this).
 *
 * **Best-effort:** analytics must never break the operation it records — a failed insert is logged
 * and swallowed. Global (via @Global CoreModule) so any feature module can inject it.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  /** Record one product event for an org. `event` is a stable dotted name (e.g. "org.created"). */
  async record(
    orgId: string,
    event: string,
    opts?: { actorUserId?: string | null; properties?: Record<string, unknown> },
  ): Promise<void> {
    try {
      await withOrgScope(this.db, orgId, (c) =>
        c.query(
          `INSERT INTO analytics_events (org_id, actor_user_id, event, properties)
           VALUES ($1, $2, $3, $4)`,
          [orgId, opts?.actorUserId ?? null, event, JSON.stringify(opts?.properties ?? {})],
        ),
      );
    } catch (err) {
      this.logger.error(`analytics record failed for "${event}": ${(err as Error).message}`);
    }
  }
}
