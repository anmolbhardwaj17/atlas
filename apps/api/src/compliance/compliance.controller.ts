import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import type { AuthedRequest } from "../auth/auth.types";
import { ApiException } from "../common/errors";
import { ComplianceService } from "./compliance.service";

/**
 * Compliance controls read API (docs/plans/compliance.md). Maps Atlas's technical evidence to the
 * infrastructure-observable subset of ISO/HIPAA/PCI/NIST/CIS/GDPR controls. Read-only, org-scoped.
 */
@Controller("compliance")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Get()
  @Roles("Member")
  async report(@Req() req: AuthedRequest): Promise<unknown> {
    if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
    return this.compliance.assess(req.org.id);
  }
}
