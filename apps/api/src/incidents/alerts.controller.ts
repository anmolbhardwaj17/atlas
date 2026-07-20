import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import type { AuthedRequest } from "../auth/auth.types";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import { AuditService } from "../core/audit.service";
import { AlertPolicyService, ALERT_POLICIES, type AlertPolicy } from "./alert-policy.service";

// Strict schema (rejects extra fields); the policy must be one of the known values (tied to the
// source list so it can't drift).
const SetPolicySchema = z
  .object({
    policy: z
      .string()
      .refine((v): v is AlertPolicy => ALERT_POLICIES.includes(v as AlertPolicy), "Invalid alert policy."),
  })
  .strict();

/**
 * Alert policy (docs/plans/proactive-incidents.md) — the org-level gate on proactive paging. Read by
 * any member (to render the toggle); changed by Admins.
 */
@Controller("alerts")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class AlertsController {
  constructor(
    private readonly policy: AlertPolicyService,
    private readonly audit: AuditService,
  ) {}

  @Get("policy")
  @Roles("Member")
  async get(@Req() req: AuthedRequest): Promise<{ policy: AlertPolicy }> {
    return { policy: await this.policy.get(orgOf(req)) };
  }

  @Put("policy")
  @Roles("Admin")
  async set(@Req() req: AuthedRequest, @Body() body: unknown): Promise<{ policy: AlertPolicy }> {
    const parsed = parseBody(SetPolicySchema, body);
    const policy = await this.policy.set(orgOf(req), parsed.policy as AlertPolicy);
    await this.audit.fromRequest(req, {
      action: "alert_policy.set",
      targetType: "org",
      targetId: orgOf(req),
      metadata: { policy },
    });
    return { policy };
  }
}

function orgOf(req: AuthedRequest): string {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org.id;
}
