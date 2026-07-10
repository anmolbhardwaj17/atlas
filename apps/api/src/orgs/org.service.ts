import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withOrgScope, type Db, type Role } from "@atlas/db";
import { PG_POOL } from "../core/tokens";
import { UserMirrorService } from "../auth/user-mirror.service";
import { ApiException } from "../common/errors";
import type { AuthClaims } from "../auth/auth.types";
import { deriveSlug } from "./slug";
import { OrgLogoService } from "./org-logo.service";
import type {
  CreateOrgBody,
  MemberDto,
  OrgDto,
  OrgProfileBody,
  OrgProfileDto,
  UpdateOrgBody,
} from "./dto";

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  logo_url: string | null;
  created_at: Date;
}

/** Shared column list so every org read returns the same DTO shape. */
const ORG_COLS = "id, slug, name, plan, status, logo_url, created_at";

const UNIQUE_VIOLATION = "23505";
function isPgUnique(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === UNIQUE_VIOLATION;
}

@Injectable()
export class OrgService {
  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    private readonly users: UserMirrorService,
    private readonly logos: OrgLogoService,
  ) {}

  /** Create an org; the creator becomes Owner (docs/12 §6.1, BR-ORG-1). The id is
   *  generated up front so the whole create runs inside that org's GUC scope (so the
   *  organizations INSERT WITH CHECK id=guc and the membership INSERT both pass). */
  async create(claims: AuthClaims, body: CreateOrgBody): Promise<OrgDto> {
    await this.users.ensureUser(claims); // FK target for the Owner membership
    const orgId = randomUUID();
    const slug = body.slug ?? deriveSlug(body.name);
    // Upload the logo (if any) up front — the id is fixed, and a failed insert only orphans a
    // tiny object. Keeps it out of the DB transaction (external network call).
    const logoUrl = body.logo ? await this.logos.upload(orgId, body.logo) : null;
    try {
      return await withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<OrgRow>(
          `INSERT INTO organizations (id, slug, name, logo_url)
           VALUES ($1, $2, $3, $4)
           RETURNING ${ORG_COLS}`,
          [orgId, slug, body.name, logoUrl],
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

  /** Upsert the org's onboarding profile (docs/12 §6.3). One row per org; last write wins. Runs in
   *  the org's RLS scope. Returns the stored profile. */
  async saveProfile(orgId: string, body: OrgProfileBody): Promise<OrgProfileDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<OrgProfileRow>(
        `INSERT INTO org_profile
           (org_id, role, team_size, use_cases, stack, industry, referral_source, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (org_id) DO UPDATE SET
           role            = EXCLUDED.role,
           team_size       = EXCLUDED.team_size,
           use_cases       = EXCLUDED.use_cases,
           stack           = EXCLUDED.stack,
           industry        = EXCLUDED.industry,
           referral_source = EXCLUDED.referral_source,
           updated_at      = now()
         RETURNING role, team_size, use_cases, stack, industry, referral_source, updated_at`,
        [
          orgId,
          body.role ?? null,
          body.teamSize ?? null,
          body.useCases ?? [],
          body.stack ?? [],
          body.industry ?? null,
          body.referralSource ?? null,
        ],
      );
      return toOrgProfileDto(rows[0]);
    });
  }

  /** The org's onboarding profile, or null if none was captured. */
  async getProfile(orgId: string): Promise<OrgProfileDto | null> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<OrgProfileRow>(
        `SELECT role, team_size, use_cases, stack, industry, referral_source, updated_at
           FROM org_profile WHERE org_id = $1`,
        [orgId],
      );
      return rows[0] ? toOrgProfileDto(rows[0]) : null;
    });
  }

  /** Hard-delete an org and ALL of its data (docs/12 §6.4). Every org-scoped table declares
   *  `org_id ... ON DELETE CASCADE`, so a single scoped DELETE sweeps the entire tenant — graph
   *  (nodes/edges/provenance/snapshots/signals), connections + their encrypted secrets, findings,
   *  notifications, members, invitations, AI history, the onboarding profile, and analytics. RLS
   *  scopes the DELETE to the active org; the FK cascade runs with the table owner's rights, so it
   *  reaches even the append-only tables (audit/analytics). **Irreversible.** The org's logo object
   *  in Storage is left orphaned (a public, now-unreferenced image — harmless). */
  async deleteOrg(orgId: string): Promise<void> {
    await withOrgScope(this.db, orgId, (c) =>
      c.query(`DELETE FROM organizations WHERE id = $1`, [orgId]),
    );
  }

  async get(orgId: string): Promise<OrgDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<OrgRow>(
        `SELECT ${ORG_COLS} FROM organizations WHERE id = $1`,
        [orgId],
      );
      const row = rows[0];
      if (!row) throw ApiException.notFound();
      return toOrgDto(row);
    });
  }

  /** Update org identity — rename and/or set/clear the logo (Admin+; docs/12 §5.2). */
  async update(orgId: string, patch: UpdateOrgBody): Promise<OrgDto> {
    // The logo upload is an external call — do it before the transaction. `logo: null` clears it.
    const logoUrl =
      patch.logo === undefined
        ? undefined
        : patch.logo === null
          ? null
          : await this.logos.upload(orgId, patch.logo);

    return withOrgScope(this.db, orgId, async (c) => {
      const sets: string[] = [];
      const params: unknown[] = [orgId];
      if (patch.name !== undefined) {
        params.push(patch.name);
        sets.push(`name = $${params.length}`);
      }
      if (logoUrl !== undefined) {
        params.push(logoUrl);
        sets.push(`logo_url = $${params.length}`);
      }
      const { rows } = await c.query<OrgRow>(
        `UPDATE organizations SET ${sets.join(", ")} WHERE id = $1 RETURNING ${ORG_COLS}`,
        params,
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
    logoUrl: row.logo_url,
    createdAt: row.created_at.toISOString(),
  };
}

interface OrgProfileRow {
  role: string | null;
  team_size: string | null;
  use_cases: string[];
  stack: string[];
  industry: string | null;
  referral_source: string | null;
  updated_at: Date;
}

function toOrgProfileDto(row: OrgProfileRow | undefined): OrgProfileDto {
  if (!row) throw new Error("expected an org_profile row");
  return {
    role: row.role,
    teamSize: row.team_size,
    useCases: row.use_cases,
    stack: row.stack,
    industry: row.industry,
    referralSource: row.referral_source,
    updatedAt: row.updated_at.toISOString(),
  };
}
