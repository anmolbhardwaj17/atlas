import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import type { AuthedRequest } from "../auth/auth.types";
import { ApiException } from "../common/errors";
import { AlertPolicyService, ALERT_POLICIES, type AlertPolicy } from "./alert-policy.service";

/**
 * Alert policy (docs/plans/proactive-incidents.md) — the org-level gate on proactive paging. Read by
 * any member (to render the toggle); changed by Admins.
 */
@Controller("alerts")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class AlertsController {
  constructor(private readonly policy: AlertPolicyService) {}

  @Get("policy")
  @Roles("Member")
  async get(@Req() req: AuthedRequest): Promise<{ policy: AlertPolicy }> {
    return { policy: await this.policy.get(orgOf(req)) };
  }

  @Put("policy")
  @Roles("Admin")
  async set(
    @Req() req: AuthedRequest,
    @Body() body: { policy?: string },
  ): Promise<{ policy: AlertPolicy }> {
    if (!body.policy || !ALERT_POLICIES.includes(body.policy as AlertPolicy)) {
      throw ApiException.validation([{ field: "policy", issue: "Invalid alert policy." }]);
    }
    return { policy: await this.policy.set(orgOf(req), body.policy as AlertPolicy) };
  }
}

function orgOf(req: AuthedRequest): string {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org.id;
}
