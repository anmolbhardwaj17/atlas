import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import { AuditService } from "../core/audit.service";
import { RateLimitService } from "../core/rate-limit.service";
import type { InferenceStats } from "@atlas/inference";
import type { AuthedRequest } from "../auth/auth.types";
import { ConnectionService } from "./connection.service";
import {
  CreateConnectionSchema,
  VerifyConnectionSchema,
  type ConnectionDto,
  type SyncTriggerDto,
} from "./dto";

/**
 * Connections (docs/08 §8). "Data" endpoints - org is selected via the `X-Atlas-Org`
 * header (TenantScopeGuard), not the path. RBAC: read = Member+, mutate = Admin+.
 * `:verify` is realized as `/verify` (Fastify can't route a colon-action on a path
 * with no dynamic suffix conflict - same convention as invitations).
 */
@Controller("connections")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class ConnectionController {
  constructor(
    private readonly connections: ConnectionService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @Roles("Admin")
  async create(@Req() req: AuthedRequest, @Body() body: unknown): Promise<ConnectionDto> {
    return this.connections.create(org(req).id, parseBody(CreateConnectionSchema, body));
  }

  @Get()
  @Roles("Member")
  async list(@Req() req: AuthedRequest): Promise<ConnectionDto[]> {
    return this.connections.list(org(req).id);
  }

  @Get(":id")
  @Roles("Member")
  async get(@Req() req: AuthedRequest, @Param("id") id: string): Promise<ConnectionDto> {
    return this.connections.get(org(req).id, id);
  }

  @Post(":id/verify")
  @Roles("Admin")
  async verify(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ConnectionDto> {
    const dto = await this.connections.verify(
      org(req).id,
      id,
      parseBody(VerifyConnectionSchema, body),
    );
    await this.audit.fromRequest(req, {
      action: "connection.verify",
      targetType: "connection",
      targetId: id,
      metadata: { provider: dto.provider, status: dto.status },
    });
    return dto;
  }

  /** Rebuild all inferred links over the current graph (no re-crawl). Admin-gated. Recovery lever
   *  when an edge was dropped (e.g. a disconnect+reconnect) but its signals are present again. */
  @Post("reindex")
  @Roles("Admin")
  async reindex(@Req() req: AuthedRequest): Promise<InferenceStats> {
    // Reindex runs the whole inference engine synchronously in the request thread — cap it so a
    // loop of clicks can't self-DoS the API (docs: rate-limit expensive endpoints). Per-org.
    await this.rateLimit.enforce(
      org(req).id,
      "reindex",
      10,
      600,
      "Links were just rebuilt. Give it a few minutes before rebuilding again.",
    );
    const stats = await this.connections.reindex(org(req).id);
    await this.audit.fromRequest(req, {
      action: "graph.reindex",
      targetType: "org",
      targetId: org(req).id,
      metadata: { upserted: stats.upserted, retired: stats.retired },
    });
    return stats;
  }

  @Post(":id/sync")
  @Roles("Admin")
  async sync(@Req() req: AuthedRequest, @Param("id") id: string): Promise<SyncTriggerDto> {
    const result = await this.connections.triggerSync(org(req).id, id);
    await this.audit.fromRequest(req, {
      action: "connection.sync",
      targetType: "connection",
      targetId: id,
      metadata: { status: result.status, runId: result.runId },
    });
    return result;
  }

  @Delete(":id")
  @Roles("Admin")
  async disconnect(@Req() req: AuthedRequest, @Param("id") id: string): Promise<ConnectionDto> {
    const dto = await this.connections.disconnect(org(req).id, id);
    await this.audit.fromRequest(req, {
      action: "connection.disconnect",
      targetType: "connection",
      targetId: id,
      metadata: { provider: dto.provider },
    });
    return dto;
  }
}

function org(req: AuthedRequest) {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
