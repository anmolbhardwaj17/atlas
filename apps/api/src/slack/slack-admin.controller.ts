import { Controller, Delete, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import type { AuthedRequest } from "../auth/auth.types";
import { SlackService } from "./slack.service";

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
function userId(req: AuthedRequest): string {
  if (!req.auth?.userId) throw ApiException.orgAccessDenied("Missing user context.");
  return req.auth.userId;
}

export interface SlackStatus {
  connected: boolean;
  teamName: string | null;
  /** The "Add to Slack" URL (null when Slack isn't configured on this deployment). */
  installUrl: string | null;
}

/**
 * Slack "Ask Atlas" — AUTHED admin routes for the Integrations hub (distinct from the @Public
 * ingress in SlackController). Reports connection status and hands back the install URL (its signed
 * `state` binds this org). Admin-only: connecting/disconnecting a workspace is an org-wide action.
 */
@Controller("integrations/slack")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class SlackAdminController {
  constructor(private readonly slack: SlackService) {}

  @Get()
  @Roles("Admin")
  async status(@Req() req: AuthedRequest): Promise<SlackStatus> {
    const install = await this.slack.installationFor(org(req).id);
    return {
      connected: install !== null,
      teamName: install?.teamName ?? null,
      installUrl: this.slack.buildInstallUrl(org(req).id, userId(req)),
    };
  }

  @Delete()
  @Roles("Admin")
  async disconnect(@Req() req: AuthedRequest): Promise<{ disconnected: boolean }> {
    return this.slack.uninstall(org(req).id);
  }
}
