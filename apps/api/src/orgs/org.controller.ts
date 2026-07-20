import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import { AuditService } from "../core/audit.service";
import { AnalyticsService } from "../core/analytics.service";
import type { AuthedRequest } from "../auth/auth.types";
import { OrgService, type PersonalDataExport } from "./org.service";
import { InvitationService } from "./invitation.service";
import {
  ChangeRoleSchema,
  CreateInviteSchema,
  CreateOrgSchema,
  OrgProfileSchema,
  UpdateOrgSchema,
  type InvitationDto,
  type MemberDto,
  type OrgDto,
  type OrgProfileDto,
} from "./dto";

/**
 * Organizations, members, invitations (docs/08 §7, docs/12 §5-6). Guard stack:
 * AuthGuard (identity) → TenantScopeGuard (active org + live role) → RolesGuard
 * (@Roles minimum). `POST /orgs` has no org yet, so it uses AuthGuard only.
 */
@Controller("orgs")
export class OrgController {
  private readonly logger = new Logger(OrgController.name);

  constructor(
    private readonly orgs: OrgService,
    private readonly invitations: InvitationService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(@Req() req: AuthedRequest, @Body() body: unknown): Promise<OrgDto> {
    const dto = await this.orgs.create(claims(req), parseBody(CreateOrgSchema, body));
    // No req.org yet (create precedes membership) - record against the new org directly.
    await this.audit.record(dto.id, {
      action: "org.create",
      actorUserId: claims(req).userId,
      targetType: "org",
      targetId: dto.id,
      requestId: req.id ?? null,
    });
    // Activation funnel, step 1 (docs/12 §6.3).
    await this.analytics.record(dto.id, "org.created", { actorUserId: claims(req).userId });
    return dto;
  }

  @Get(":orgId/profile")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Member")
  async getProfile(@Req() req: AuthedRequest): Promise<OrgProfileDto | null> {
    return this.orgs.getProfile(org(req).id);
  }

  @Put(":orgId/profile")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async saveProfile(@Req() req: AuthedRequest, @Body() body: unknown): Promise<OrgProfileDto> {
    const orgId = org(req).id;
    const profile = await this.orgs.saveProfile(orgId, parseBody(OrgProfileSchema, body));
    // Activation funnel, step 2 — the onboarding answers double as segmentation (docs/12 §6.3).
    await this.analytics.record(orgId, "onboarding.completed", {
      actorUserId: claims(req).userId,
      properties: {
        role: profile.role,
        teamSize: profile.teamSize,
        useCases: profile.useCases,
        stack: profile.stack,
        industry: profile.industry,
        referralSource: profile.referralSource,
      },
    });
    return profile;
  }

  @Get(":orgId")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Member")
  async get(@Req() req: AuthedRequest): Promise<OrgDto> {
    return this.orgs.get(org(req).id);
  }

  /** Personal-data export (GDPR right of access) — the personal data Atlas holds for this org, so an
   *  admin can answer a data-subject request. Admin-only, and the export itself is audited. */
  @Get(":orgId/data-export")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async dataExport(@Req() req: AuthedRequest): Promise<PersonalDataExport> {
    const orgId = org(req).id;
    const data = await this.orgs.personalDataExport(orgId);
    await this.audit.fromRequest(req, {
      action: "org.data_export",
      targetType: "org",
      targetId: orgId,
      metadata: { members: data.members.length, identities: data.identities.length },
    });
    return data;
  }

  @Patch(":orgId")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async update(@Req() req: AuthedRequest, @Body() body: unknown): Promise<OrgDto> {
    const dto = await this.orgs.update(org(req).id, parseBody(UpdateOrgSchema, body));
    await this.audit.fromRequest(req, {
      action: "org.update",
      targetType: "org",
      targetId: org(req).id,
      metadata: { name: dto.name },
    });
    return dto;
  }

  /** Permanently delete the org and everything in it (docs/12 §6.4). **Owner-only** — the most
   *  destructive action in the app. Logged server-side (the audit row would be cascaded away with
   *  the org, so it can't live in the org's own audit log). */
  @Delete(":orgId")
  @HttpCode(204)
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Owner")
  async remove(@Req() req: AuthedRequest): Promise<void> {
    const orgId = org(req).id;
    await this.orgs.deleteOrg(orgId, claims(req).userId ?? null);
    this.logger.warn(`org.delete: org ${orgId} permanently deleted by user ${claims(req).userId}`);
  }

  @Get(":orgId/members")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Member")
  async members(@Req() req: AuthedRequest): Promise<MemberDto[]> {
    return this.orgs.listMembers(org(req).id);
  }

  @Patch(":orgId/members/:userId")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async changeRole(
    @Req() req: AuthedRequest,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ): Promise<MemberDto> {
    const { id, role } = org(req);
    const newRole = parseBody(ChangeRoleSchema, body).role;
    const member = await this.orgs.changeRole(id, role, userId, newRole);
    await this.audit.fromRequest(req, {
      action: "member.role_change",
      targetType: "user",
      targetId: userId,
      metadata: { newRole },
    });
    return member;
  }

  @Delete(":orgId/members/:userId")
  @HttpCode(204)
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async removeMember(@Req() req: AuthedRequest, @Param("userId") userId: string): Promise<void> {
    const { id, role } = org(req);
    await this.orgs.removeMember(id, role, userId);
    await this.audit.fromRequest(req, {
      action: "member.remove",
      targetType: "user",
      targetId: userId,
    });
  }

  @Post(":orgId/invitations")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async invite(@Req() req: AuthedRequest, @Body() body: unknown): Promise<InvitationDto> {
    const invite = await this.invitations.create(
      org(req).id,
      claims(req).userId,
      parseBody(CreateInviteSchema, body),
    );
    await this.audit.fromRequest(req, {
      action: "invitation.create",
      targetType: "invitation",
      targetId: invite.id,
      metadata: { email: invite.email, role: invite.role },
    });
    return invite;
  }

  @Get(":orgId/invitations")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async listInvites(@Req() req: AuthedRequest): Promise<InvitationDto[]> {
    return this.invitations.list(org(req).id);
  }

  @Delete(":orgId/invitations/:invitationId")
  @HttpCode(204)
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async revokeInvite(
    @Req() req: AuthedRequest,
    @Param("invitationId") invitationId: string,
  ): Promise<void> {
    await this.invitations.revoke(org(req).id, invitationId);
    await this.audit.fromRequest(req, {
      action: "invitation.revoke",
      targetType: "invitation",
      targetId: invitationId,
    });
  }
}

function claims(req: AuthedRequest) {
  if (!req.auth) throw ApiException.orgAccessDenied("Missing authentication context.");
  return req.auth;
}
function org(req: AuthedRequest) {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
