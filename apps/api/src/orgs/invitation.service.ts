import { Inject, Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { withOrgScope, type Db, type Role } from "@atlas/db";
import type { Env } from "@atlas/config";
import { ENV, PG_POOL } from "../core/tokens";
import { EmailService } from "../core/email.service";
import { RateLimitService } from "../core/rate-limit.service";
import { UserMirrorService } from "../auth/user-mirror.service";
import { ApiException } from "../common/errors";
import type { AuthClaims } from "../auth/auth.types";
import type { CreateInviteBody, InvitationDto, OrgDto } from "./dto";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Abuse limits on invite creation (security sweep M4): each invite sends a Resend email from our
// domain, so an unthrottled admin could spam arbitrary addresses → quota burn + reputation damage.
const INVITE_RATE_LIMIT = 20; // new invites per org per hour
const INVITE_RATE_WINDOW_S = 60 * 60;
const MAX_PENDING_INVITES = 100; // hard ceiling on outstanding pending invites per org
const UNIQUE_VIOLATION = "23505";
function isPgUnique(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === UNIQUE_VIOLATION;
}
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface InviteRow {
  id: string;
  email: string;
  role: Role;
  status: string;
  expires_at: Date;
  created_at: Date;
}

/**
 * Invitations (docs/12 §6.2, docs/08 §7). The raw token is single-use and only its SHA-256 hash is
 * stored. It is delivered out of band (email), and additionally returned ONCE in the `create`
 * response — to the creating Admin only — as a copyable accept link, so an invite still works when
 * email delivery is unavailable (BR-INV-1, docs/13: "returned once, to the creator; never surfaced
 * to anyone else, never re-fetchable"). Accept is capability-based: the bearer of the token, signed
 * in as the invited email, atomically gains an active membership.
 */
@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly users: UserMirrorService,
    private readonly email: EmailService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async create(
    orgId: string,
    inviterUserId: string,
    body: CreateInviteBody,
  ): Promise<InvitationDto> {
    // Rate-limit invite creation (M4) — bounds email volume from our sending domain per org/hour.
    await this.rateLimit.enforce(
      orgId,
      "invite",
      INVITE_RATE_LIMIT,
      INVITE_RATE_WINDOW_S,
      "Too many invitations sent recently. Please wait a bit before inviting more people.",
    );
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    try {
      const { dto, orgName } = await withOrgScope(this.db, orgId, async (c) => {
        // Cap outstanding pending invites so the rate limit can't be walked around by never accepting.
        const { rows: pending } = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM invitations WHERE status = 'pending'`,
        );
        if ((pending[0]?.n ?? 0) >= MAX_PENDING_INVITES) {
          throw ApiException.tooManyRequests(
            "This organization has too many pending invitations. Revoke some before sending more.",
          );
        }
        const { rows } = await c.query<InviteRow>(
          `INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, role, status, expires_at, created_at`,
          [orgId, body.email, body.role, hashToken(token), inviterUserId, expiresAt],
        );
        const { rows: orgRows } = await c.query<{ name: string }>(
          `SELECT name FROM organizations WHERE id = $1`,
          [orgId],
        );
        return { dto: toInviteDto(rows[0]), orgName: orgRows[0]?.name ?? "your team" };
      });
      // Deliver the accept link by email (Resend), and also return it so the UI can offer a
      // copyable link — the link works even if email delivery is unavailable.
      const acceptUrl = `${this.env.WEB_ORIGIN}/invite/${token}`;
      const emailed = await this.email.sendInvite({ to: dto.email, orgName, role: dto.role, acceptUrl });
      this.logger.log(`Invitation ${dto.id} for ${dto.email} created (emailed: ${emailed}).`);
      return { ...dto, acceptUrl, emailed };
    } catch (e) {
      if (isPgUnique(e)) {
        throw ApiException.alreadyExists("A pending invitation already exists for this email.");
      }
      throw e;
    }
  }

  async list(orgId: string): Promise<InvitationDto[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<InviteRow>(
        `SELECT id, email, role, status, expires_at, created_at
         FROM invitations WHERE status = 'pending' ORDER BY created_at DESC`,
      );
      return rows.map(toInviteDto);
    });
  }

  async revoke(orgId: string, invitationId: string): Promise<void> {
    await withOrgScope(this.db, orgId, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE invitations SET status = 'revoked' WHERE id = $1 AND status = 'pending'`,
        [invitationId],
      );
      if (!rowCount) throw ApiException.notFound();
    });
  }

  /** Accept by token (docs/12 §6.2). Cross-org lookup via the SECURITY DEFINER
   *  resolver (the token is the capability). Requires the caller's verified email to
   *  match the invite; creates the user (if new) + an active membership atomically. */
  async accept(token: string, claims: AuthClaims): Promise<{ org: OrgDto; role: Role }> {
    if (!claims.emailVerified) {
      throw ApiException.orgAccessDenied("Verify your email before accepting an invitation.");
    }
    const { rows } = await this.db.query<{
      id: string;
      org_id: string;
      email: string;
      role: Role;
      status: string;
      expires_at: Date;
    }>("SELECT id, org_id, email, role, status, expires_at FROM app_invitation_by_token($1)", [
      hashToken(token),
    ]);
    const invite = rows[0];
    if (!invite) throw ApiException.notFound("Invitation not found.");
    if (invite.status !== "pending") {
      throw ApiException.invalidState(`Invitation is ${invite.status}.`);
    }
    if (invite.expires_at.getTime() <= Date.now()) {
      throw ApiException.invalidState("Invitation has expired.");
    }
    if (invite.email.toLowerCase() !== claims.email.toLowerCase()) {
      throw ApiException.orgAccessDenied(
        "This invitation was sent to a different email - sign in with that address.",
      );
    }

    await this.users.ensureUser(claims); // FK target for the membership
    return withOrgScope(this.db, invite.org_id, async (c) => {
      // Atomically CLAIM the invite first (L3): the `status = 'pending'` guard means only one accept
      // can ever flip it, so single-use rests on the DB, not on app ordering. The status check above
      // is off-transaction (best-effort UX); this is the real gate — 0 rows ⇒ already consumed/raced.
      const claim = await c.query(
        `UPDATE invitations SET status = 'accepted' WHERE id = $1 AND status = 'pending'`,
        [invite.id],
      );
      if (!claim.rowCount) {
        throw ApiException.invalidState("This invitation has already been used.");
      }
      await c.query(
        `INSERT INTO memberships (org_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'active'`,
        [invite.org_id, claims.userId, invite.role],
      );
      const { rows: orgRows } = await c.query<{
        id: string;
        slug: string;
        name: string;
        plan: string;
        status: string;
        logo_url: string | null;
        created_at: Date;
      }>(
        `SELECT id, slug, name, plan, status, logo_url, created_at FROM organizations WHERE id = $1`,
        [invite.org_id],
      );
      const org = orgRows[0];
      if (!org) throw ApiException.notFound();
      return {
        org: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          plan: org.plan,
          status: org.status,
          logoUrl: org.logo_url,
          createdAt: org.created_at.toISOString(),
        },
        role: invite.role,
      };
    });
  }
}

function toInviteDto(row: InviteRow | undefined): InvitationDto {
  if (!row) throw new Error("expected an invitation row");
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}
