import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "../auth/auth.types";
import { guidanceFor } from "@atlas/ai";
import { GraphService } from "./graph.service";
import {
  EdgesQuerySchema,
  GraphQuerySchema,
  NeighborsQuerySchema,
  NodeListQuerySchema,
  TimelineQuerySchema,
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

  @Get("overview")
  @Roles("Member")
  async overview(@Req() req: AuthedRequest): Promise<unknown> {
    return this.graph.overview(org(req).id);
  }

  @Get("summary")
  @Roles("Member")
  async summary(@Req() req: AuthedRequest): Promise<unknown> {
    return this.graph.summary(org(req).id);
  }

  /**
   * Insights (Atlas Knowledge Engine P4 slice): the graph's grounded findings enriched with the
   * advisory knowledge pack's guidance (why it matters / how to fix). Proactive, personalized —
   * every card is a fact Atlas proves + best-practice guidance, and links into an Ask Atlas thread.
   */
  /**
   * Insights (Atlas Knowledge Engine) — the ADVISORY / action layer (distinct from the dashboard's
   * status glance). Returns the graph's grounded findings enriched with the advisory knowledge
   * pack's guidance (why/fix/pillar/source), plus an action-framed summary (severity counts +
   * CI/CD coverage as an opportunity). Recomputed live, so it reflects the latest sync.
   */
  @Get("insights")
  @Roles("Member")
  async insights(@Req() req: AuthedRequest): Promise<unknown> {
    const s = await this.graph.summary(org(req).id);
    const bySeverity = { high: 0, medium: 0, low: 0 };
    for (const f of s.findings) bySeverity[f.severity] += 1;
    return {
      summary: {
        total: s.findings.length,
        ...bySeverity,
        pipelineCoverage: s.insights.pipelineCoverage,
      },
      findings: s.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        category: f.category,
        title: f.title,
        detail: f.detail,
        href: f.href,
        ...(f.count !== undefined ? { count: f.count } : {}),
        guidance: guidanceFor(f.category),
      })),
    };
  }

  @Get("graph")
  @Roles("Member")
  async graphMap(@Req() req: AuthedRequest, @Query() query: unknown): Promise<unknown> {
    return this.graph.graph(org(req).id, parseBody(GraphQuerySchema, query));
  }

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

  @Get("edges/:id")
  @Roles("Member")
  async getEdge(@Req() req: AuthedRequest, @Param("id") id: string): Promise<unknown> {
    return this.graph.getEdge(org(req).id, id);
  }

  @Get("timeline")
  @Roles("Member")
  async timeline(@Req() req: AuthedRequest, @Query() query: unknown): Promise<unknown> {
    return this.graph.timeline(org(req).id, parseBody(TimelineQuerySchema, query));
  }
}

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
