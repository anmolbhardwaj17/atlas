import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "../auth/auth.types";
import { OrgService } from "./org.service";
import { InvitationService } from "./invitation.service";
import {
  ChangeRoleSchema,
  CreateInviteSchema,
  CreateOrgSchema,
  RenameOrgSchema,
  type InvitationDto,
  type MemberDto,
  type OrgDto,
} from "./dto";

/**
 * Organizations, members, invitations (docs/08 §7, docs/12 §5–6). Guard stack:
 * AuthGuard (identity) → TenantScopeGuard (active org + live role) → RolesGuard
 * (@Roles minimum). `POST /orgs` has no org yet, so it uses AuthGuard only.
 */
@Controller("orgs")
export class OrgController {
  constructor(
    private readonly orgs: OrgService,
    private readonly invitations: InvitationService,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  async create(@Req() req: AuthedRequest, @Body() body: unknown): Promise<OrgDto> {
    return this.orgs.create(claims(req), parseBody(CreateOrgSchema, body));
  }

  @Get(":orgId")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Member")
  async get(@Req() req: AuthedRequest): Promise<OrgDto> {
    return this.orgs.get(org(req).id);
  }

  @Patch(":orgId")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async rename(@Req() req: AuthedRequest, @Body() body: unknown): Promise<OrgDto> {
    return this.orgs.rename(org(req).id, parseBody(RenameOrgSchema, body).name);
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
    return this.orgs.changeRole(id, role, userId, parseBody(ChangeRoleSchema, body).role);
  }

  @Delete(":orgId/members/:userId")
  @HttpCode(204)
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async removeMember(@Req() req: AuthedRequest, @Param("userId") userId: string): Promise<void> {
    const { id, role } = org(req);
    await this.orgs.removeMember(id, role, userId);
  }

  @Post(":orgId/invitations")
  @UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
  @Roles("Admin")
  async invite(@Req() req: AuthedRequest, @Body() body: unknown): Promise<InvitationDto> {
    return this.invitations.create(
      org(req).id,
      claims(req).userId,
      parseBody(CreateInviteSchema, body),
    );
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
