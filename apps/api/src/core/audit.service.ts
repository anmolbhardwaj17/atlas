import { Inject, Injectable, Logger } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import { PG_POOL } from "./tokens";
import type { AuthedRequest } from "../auth/auth.types";

/** A security-relevant action worth recording (docs/13 §8). `action` is a stable verb. */
export interface AuditEvent {
  action: string;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}

/**
 * Append-only audit log (docs/13 §8). Records who did what to which target, org-scoped and
 * correlated by request id. Writes go through `withOrgScope` (RLS-enforced) into the
 * append-only `audit_events` table (atlas_app has INSERT+SELECT only — no UPDATE/DELETE).
 *
 * **Best-effort:** auditing must never break the operation it records — a failed insert is
 * logged loudly and swallowed (the mutation already succeeded). Global (provided by the
 * @Global CoreModule) so any feature module can inject it.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  async record(orgId: string, event: AuditEvent): Promise<void> {
    try {
      await withOrgScope(this.db, orgId, (c) =>
        c.query(
          `INSERT INTO audit_events
             (org_id, actor_user_id, action, target_type, target_id, metadata, request_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orgId,
            event.actorUserId ?? null,
            event.action,
            event.targetType ?? null,
            event.targetId ?? null,
            JSON.stringify(event.metadata ?? {}),
            event.requestId ?? null,
          ],
        ),
      );
    } catch (err) {
      this.logger.error(`audit record failed for "${event.action}": ${(err as Error).message}`);
    }
  }

  /**
   * Convenience: record from an authed request, pulling actor + correlation id off the
   * request so call sites only pass the action + target.
   */
  async fromRequest(
    req: AuthedRequest,
    event: Omit<AuditEvent, "actorUserId" | "requestId">,
  ): Promise<void> {
    const orgId = req.org?.id;
    if (!orgId) return;
    await this.record(orgId, {
      ...event,
      actorUserId: req.auth?.userId ?? null,
      requestId: req.id ?? null,
    });
  }
}
