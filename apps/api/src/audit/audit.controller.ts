import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { AuditService, type AuditEventView } from "../core/audit.service";
import type { AuthedRequest } from "../auth/auth.types";

/**
 * Audit log read API (docs/13 §8 — "trust is visible"). `GET /audit` returns the org's
 * recent security-relevant events, newest first. Org selected via `X-Atlas-Org`
 * (TenantScopeGuard); **Admin+** only (the log names actors + actions — sensitive).
 */
@Controller("audit")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles("Admin")
  async list(@Req() req: AuthedRequest, @Query("limit") limit?: string): Promise<AuditEventView[]> {
    const n = limit ? Number(limit) : undefined;
    return this.audit.list(org(req).id, Number.isFinite(n) ? n : undefined);
  }
}

function org(req: AuthedRequest) {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
