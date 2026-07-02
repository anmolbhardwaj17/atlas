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

/** A recorded event with the actor resolved, for the read API / UI. */
export interface AuditEventView {
  id: string;
  action: string;
  actor: { userId: string | null; email: string | null };
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
  createdAt: string;
}

interface AuditRow {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_email: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  request_id: string | null;
  created_at: Date;
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

  /**
   * Recent audit events for an org, newest first (docs/13 §8 — "trust is visible"). Admin
   * read only (enforced at the controller). Org-scoped via RLS; the actor email is joined
   * from `users` (a global identity table `atlas_app` may read). `limit` is clamped 1..200.
   */
  async list(orgId: string, limit = 50): Promise<AuditEventView[]> {
    const capped = Math.min(Math.max(1, limit), 200);
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<AuditRow>(
        `SELECT a.id, a.action, a.actor_user_id, u.email AS actor_email,
                a.target_type, a.target_id, a.metadata, a.request_id, a.created_at
           FROM audit_events a
           LEFT JOIN users u ON u.id = a.actor_user_id
          WHERE a.org_id = $1
          ORDER BY a.created_at DESC, a.id DESC
          LIMIT $2`,
        [orgId, capped],
      );
      return rows.map((r) => ({
        id: r.id,
        action: r.action,
        actor: { userId: r.actor_user_id, email: r.actor_email },
        targetType: r.target_type,
        targetId: r.target_id,
        metadata: r.metadata,
        requestId: r.request_id,
        createdAt: r.created_at.toISOString(),
      }));
    });
  }
}
