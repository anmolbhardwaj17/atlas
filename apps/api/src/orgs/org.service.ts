import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withOrgScope, type Db, type Role } from "@atlas/db";
import type { SnapshotStore } from "@atlas/ingest";
import { PG_POOL } from "../core/tokens";
import { SNAPSHOT_STORE } from "../connections/tokens";
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

/** The personal data Atlas holds for an org — the DSAR (right-of-access) deliverable. */
export interface PersonalDataExport {
  generatedAt: string;
  org: { name: string; slug: string };
  members: Array<{
    email: string;
    name: string | null;
    role: string;
    status: string;
    joinedAt: string;
  }>;
  identities: Array<{
    urn: string;
    kind: string;
    name: string | null;
    login: string | null;
    displayName: string | null;
    email: string | null;
  }>;
}

/** A string attribute if present + non-empty, else null (for the identity export). */
function strAttr(attrs: Record<string, unknown>, key: string): string | null {
  const v = attrs?.[key];
  return typeof v === "string" && v ? v : null;
}

const UNIQUE_VIOLATION = "23505";
function isPgUnique(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === UNIQUE_VIOLATION;
}

@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(SNAPSHOT_STORE) private readonly snapshots: SnapshotStore,
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
        `INSERT INTO org_settings
           (org_id, role, team_size, use_cases, stack, industry, referral_source, profile_updated_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
         ON CONFLICT (org_id) DO UPDATE SET
           role               = EXCLUDED.role,
           team_size          = EXCLUDED.team_size,
           use_cases          = EXCLUDED.use_cases,
           stack              = EXCLUDED.stack,
           industry           = EXCLUDED.industry,
           referral_source    = EXCLUDED.referral_source,
           profile_updated_at = now(),
           updated_at         = now()
         RETURNING role, team_size, use_cases, stack, industry, referral_source, profile_updated_at AS updated_at`,
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
        `SELECT role, team_size, use_cases, stack, industry, referral_source, profile_updated_at AS updated_at
           FROM org_settings WHERE org_id = $1 AND profile_updated_at IS NOT NULL`,
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
  async deleteOrg(orgId: string, actorUserId: string | null = null): Promise<void> {
    await withOrgScope(this.db, orgId, async (c) => {
      // Record the deletion in the out-of-tenant sink BEFORE the cascade — the org's own audit_events
      // vanish with it, so this is the only durable, provable record of who deleted the org and when
      // (org_deletion_log has no FK to organizations, so it survives). Same transaction as the delete.
      const { rows } = await c.query<{ slug: string; name: string }>(
        `SELECT slug, name FROM organizations WHERE id = $1`,
        [orgId],
      );
      await c.query(
        `INSERT INTO org_deletion_log (deleted_org_id, org_slug, org_name, actor_user_id)
         VALUES ($1, $2, $3, $4)`,
        [orgId, rows[0]?.slug ?? null, rows[0]?.name ?? null, actorUserId],
      );
      await c.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
    });
    // The DB cascade only removes rows; objects in Storage (raw-snapshot blobs that embed author
    // names / PR / Jira contents, and the org logo) are pointers, so erase those too — otherwise
    // "delete my org" leaves the raw payloads in the bucket, defeating GDPR erasure. Best-effort
    // after the cascade: a Storage hiccup shouldn't fail the delete, but it's logged.
    await this.snapshots
      .deleteByOrg(orgId)
      .catch((e) => this.logger.warn(`snapshot blob purge failed (org ${orgId}): ${String(e)}`));
    await this.logos
      .delete(orgId)
      .catch((e) => this.logger.warn(`logo purge failed (org ${orgId}): ${String(e)}`));
  }

  /**
   * Personal-data export (GDPR Art. 15/20 — right of access + portability). Gathers the personal
   * data Atlas holds for an org so an admin can answer a data-subject request: the org's members
   * (identity we store directly) and every person/team identity node the connectors ingested (login
   * + display name; PR/commit/ticket author names in node attributes all resolve to these). Org-
   * scoped (RLS). Not a full graph dump — just the personal data, which is what a DSAR concerns.
   */
  async personalDataExport(orgId: string): Promise<PersonalDataExport> {
    return withOrgScope(this.db, orgId, async (c) => {
      const org = (
        await c.query<{ name: string; slug: string }>(
          `SELECT name, slug FROM organizations WHERE id = $1`,
          [orgId],
        )
      ).rows[0];
      if (!org) throw ApiException.notFound();
      const members = (
        await c.query<{
          email: string;
          name: string | null;
          role: string;
          status: string;
          joined_at: Date;
        }>(
          `SELECT u.email, u.name, m.role, m.status, m.created_at AS joined_at
             FROM memberships m JOIN users u ON u.id = m.user_id
            ORDER BY m.created_at`,
        )
      ).rows.map((m) => ({
        email: m.email,
        name: m.name,
        role: m.role,
        status: m.status,
        joinedAt: m.joined_at.toISOString(),
      }));
      const identities = (
        await c.query<{
          urn: string;
          kind: string;
          name: string | null;
          attributes: Record<string, unknown>;
        }>(
          `SELECT urn, kind, name, attributes FROM nodes
            WHERE (kind LIKE '%.user' OR kind LIKE '%.team') AND status <> 'deleted'
            ORDER BY kind, name`,
        )
      ).rows.map((n) => ({
        urn: n.urn,
        kind: n.kind,
        name: n.name,
        // Only the identity-bearing attributes (login / display name / email), never the whole blob.
        login: strAttr(n.attributes, "login") ?? strAttr(n.attributes, "username"),
        displayName: strAttr(n.attributes, "displayName") ?? strAttr(n.attributes, "display_name"),
        email: strAttr(n.attributes, "email"),
      }));
      return {
        generatedAt: new Date().toISOString(),
        org: { name: org.name, slug: org.slug },
        members,
        identities,
      };
    });
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
  if (!row) throw new Error("expected an org_settings row");
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
