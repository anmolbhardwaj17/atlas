import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withOrgScope, type Db, type Role } from "@atlas/db";
import { PG_POOL } from "../core/tokens";
import { UserMirrorService } from "../auth/user-mirror.service";
import { ApiException } from "../common/errors";
import type { AuthClaims } from "../auth/auth.types";
import { deriveSlug } from "./slug";
import type { CreateOrgBody, MemberDto, OrgDto } from "./dto";

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  created_at: Date;
}

const UNIQUE_VIOLATION = "23505";
function isPgUnique(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === UNIQUE_VIOLATION;
}

@Injectable()
export class OrgService {
  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    private readonly users: UserMirrorService,
  ) {}

  /** Create an org; the creator becomes Owner (docs/12 §6.1, BR-ORG-1). The id is
   *  generated up front so the whole create runs inside that org's GUC scope (so the
   *  organizations INSERT WITH CHECK id=guc and the membership INSERT both pass). */
  async create(claims: AuthClaims, body: CreateOrgBody): Promise<OrgDto> {
    await this.users.ensureUser(claims); // FK target for the Owner membership
    const orgId = randomUUID();
    const slug = body.slug ?? deriveSlug(body.name);
    try {
      return await withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<OrgRow>(
          `INSERT INTO organizations (id, slug, name)
           VALUES ($1, $2, $3)
           RETURNING id, slug, name, plan, status, created_at`,
          [orgId, slug, body.name],
        );
        await c.query(
          `INSERT INTO memberships (org_id, user_id, role, status)
           VALUES ($1, $2, 'Owner', 'active')`,
          [orgId, claims.userId],
        );
        return toOrgDto(rows[0]);
      });
    } catch (e) {
      if (isPgUnique(e)) throw ApiException.alreadyExists(`Organization slug "${slug}" is taken.`);
      throw e;
    }
  }

  async get(orgId: string): Promise<OrgDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<OrgRow>(
        `SELECT id, slug, name, plan, status, created_at FROM organizations WHERE id = $1`,
        [orgId],
      );
      const row = rows[0];
      if (!row) throw ApiException.notFound();
      return toOrgDto(row);
    });
  }

  async rename(orgId: string, name: string): Promise<OrgDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<OrgRow>(
        `UPDATE organizations SET name = $2 WHERE id = $1
         RETURNING id, slug, name, plan, status, created_at`,
        [orgId, name],
      );
      const row = rows[0];
      if (!row) throw ApiException.notFound();
      return toOrgDto(row);
    });
  }

  async listMembers(orgId: string): Promise<MemberDto[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        user_id: string;
        email: string;
        name: string | null;
        avatar_url: string | null;
        role: Role;
        status: string;
        created_at: Date;
      }>(
        `SELECT m.user_id, u.email, u.name, u.avatar_url, m.role, m.status, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
         ORDER BY m.created_at`,
      );
      return rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        name: r.name,
        avatarUrl: r.avatar_url,
        role: r.role,
        status: r.status,
        joinedAt: r.created_at.toISOString(),
      }));
    });
  }

  /** Change a member's role, enforcing the BR invariants (docs/12 §5.2). */
  async changeRole(
    orgId: string,
    callerRole: Role,
    targetUserId: string,
    newRole: Role,
  ): Promise<MemberDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      const target = await loadMember(c, targetUserId);
      // BR-MEM-3: only an Owner may modify an Owner.
      if (target.role === "Owner" && callerRole !== "Owner") {
        throw ApiException.insufficientRole("Only an Owner can modify an Owner.");
      }
      // Only an Owner may grant Owner (transfer/ownership escalation).
      if (newRole === "Owner" && callerRole !== "Owner") {
        throw ApiException.insufficientRole("Only an Owner can grant the Owner role.");
      }
      // BR-MEM-2 / BR-ORG-1: never demote the last Owner.
      if (target.role === "Owner" && newRole !== "Owner" && (await ownerCount(c)) <= 1) {
        throw ApiException.invalidState("Cannot demote the last Owner - promote another first.");
      }
      const { rows } = await c.query<{
        user_id: string;
        email: string;
        name: string | null;
        avatar_url: string | null;
        role: Role;
        status: string;
        created_at: Date;
      }>(
        `UPDATE memberships m SET role = $2 FROM users u
         WHERE m.user_id = $1 AND u.id = m.user_id
         RETURNING m.user_id, u.email, u.name, u.avatar_url, m.role, m.status, m.created_at`,
        [targetUserId, newRole],
      );
      const r = rows[0];
      if (!r) throw ApiException.notFound();
      return {
        userId: r.user_id,
        email: r.email,
        avatarUrl: r.avatar_url,
        name: r.name,
        role: r.role,
        status: r.status,
        joinedAt: r.created_at.toISOString(),
      };
    });
  }

  async removeMember(orgId: string, callerRole: Role, targetUserId: string): Promise<void> {
    await withOrgScope(this.db, orgId, async (c) => {
      const target = await loadMember(c, targetUserId);
      if (target.role === "Owner" && callerRole !== "Owner") {
        throw ApiException.insufficientRole("Only an Owner can remove an Owner.");
      }
      if (target.role === "Owner" && (await ownerCount(c)) <= 1) {
        throw ApiException.invalidState("Cannot remove the last Owner.");
      }
      await c.query(`DELETE FROM memberships WHERE user_id = $1`, [targetUserId]);
    });
  }
}

async function loadMember(c: PoolClient, userId: string): Promise<{ role: Role }> {
  const { rows } = await c.query<{ role: Role }>(
    `SELECT role FROM memberships WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw ApiException.notFound();
  return row;
}

async function ownerCount(c: PoolClient): Promise<number> {
  const { rows } = await c.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM memberships WHERE role = 'Owner' AND status = 'active'`,
  );
  return Number(rows[0]?.n ?? "0");
}

function toOrgDto(row: OrgRow | undefined): OrgDto {
  if (!row) throw new Error("expected an organization row");
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    plan: row.plan,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}
