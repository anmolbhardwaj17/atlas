import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "../auth/auth.types";
import { SEARCH_PROVIDER, SearchQuerySchema, type SearchProvider } from "./search.provider";

/** Search (docs/08 §10.1, docs/11). Hybrid keyword+semantic; MVP is keyword (Postgres). */
@Controller("search")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class SearchController {
  constructor(@Inject(SEARCH_PROVIDER) private readonly search: SearchProvider) {}

  @Get()
  @Roles("Member")
  async run(@Req() req: AuthedRequest, @Query() query: unknown): Promise<unknown> {
    return this.search.search(org(req).id, parseBody(SearchQuerySchema, query));
  }
}

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
