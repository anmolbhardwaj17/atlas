import { Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import type { AuthedRequest } from "../auth/auth.types";
import { DemoService } from "./demo.service";

/**
 * Demo data (P1.2, docs/09 §8). `POST /demo/seed` loads the sample "Shopyard" estate for
 * the onboarding empty state. Org selected via `X-Atlas-Org` (TenantScopeGuard);
 * Admin-only (writes graph data). Gated to empty orgs in the service.
 */
@Controller("demo")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post("seed")
  @Roles("Admin")
  async seed(@Req() req: AuthedRequest): Promise<unknown> {
    return this.demo.seed(org(req).id);
  }
}

function org(req: AuthedRequest) {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
