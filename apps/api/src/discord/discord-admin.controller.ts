import { Controller, Delete, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import type { AuthedRequest } from "../auth/auth.types";
import { DiscordService } from "./discord.service";

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
function userId(req: AuthedRequest): string {
  if (!req.auth?.userId) throw ApiException.orgAccessDenied("Missing user context.");
  return req.auth.userId;
}

export interface DiscordStatus {
  connected: boolean;
  guildName: string | null;
  installUrl: string | null;
}

/**
 * Discord "Ask Atlas" — AUTHED admin routes for the Integrations hub (distinct from the @Public
 * ingress). Reports connection status + the install URL (signed state binds this org). Admin-only:
 * connecting/disconnecting a server is an org-wide action.
 */
@Controller("integrations/discord")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class DiscordAdminController {
  constructor(private readonly discord: DiscordService) {}

  @Get()
  @Roles("Admin")
  async status(@Req() req: AuthedRequest): Promise<DiscordStatus> {
    const install = await this.discord.installationFor(org(req).id);
    return {
      connected: install !== null,
      guildName: install?.guildName ?? null,
      installUrl: this.discord.buildInstallUrl(org(req).id, userId(req)),
    };
  }

  @Delete()
  @Roles("Admin")
  async disconnect(@Req() req: AuthedRequest): Promise<{ disconnected: boolean }> {
    return this.discord.uninstall(org(req).id);
  }
}
