import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "../auth/auth.types";
import { GraphService } from "./graph.service";
import {
  EdgesQuerySchema,
  NeighborsQuerySchema,
  NodeListQuerySchema,
  TraversalQuerySchema,
} from "./dto";

/**
 * Graph read API (docs/08 §9). Org selected via `X-Atlas-Org` (TenantScopeGuard); all
 * reads require Member+. Traversals (blast-radius/dependencies) arrive in G2.2.
 */
@Controller()
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get("nodes")
  @Roles("Member")
  async listNodes(@Req() req: AuthedRequest, @Query() query: unknown): Promise<unknown> {
    return this.graph.listNodes(org(req).id, parseBody(NodeListQuerySchema, query));
  }

  @Get("nodes/:id")
  @Roles("Member")
  async getNode(@Req() req: AuthedRequest, @Param("id") id: string): Promise<unknown> {
    return this.graph.getNode(org(req).id, id);
  }

  @Get("nodes/:id/edges")
  @Roles("Member")
  async nodeEdges(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.graph.nodeEdges(org(req).id, id, parseBody(EdgesQuerySchema, query));
  }

  @Get("nodes/:id/neighbors")
  @Roles("Member")
  async nodeNeighbors(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.graph.nodeNeighbors(org(req).id, id, parseBody(NeighborsQuerySchema, query));
  }

  @Get("nodes/:id/blast-radius")
  @Roles("Member")
  async blastRadius(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.graph.blastRadius(org(req).id, id, parseBody(TraversalQuerySchema, query));
  }

  @Get("nodes/:id/dependencies")
  @Roles("Member")
  async dependencies(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ): Promise<unknown> {
    return this.graph.dependencies(org(req).id, id, parseBody(TraversalQuerySchema, query));
  }
}

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
