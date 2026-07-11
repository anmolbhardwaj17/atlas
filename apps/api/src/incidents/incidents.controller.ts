import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import type { AuthedRequest } from "../auth/auth.types";
import { ApiException } from "../common/errors";
import {
  IncidentsService,
  type Incident,
  type IncidentStatus,
  type IncidentTrigger,
} from "./incidents.service";

const TRIGGERS = new Set<IncidentTrigger>(["map", "finding", "alert", "manual"]);
const STATUSES = new Set<IncidentStatus>(["open", "analyzing", "resolved", "dismissed"]);

interface OpenBody {
  nodeId?: string;
  trigger?: string;
}
interface UpdateBody {
  status?: string;
  verdict?: unknown;
  evidence?: unknown;
  resolution?: string | null;
}

/**
 * War Room incidents (docs/plans/war-room.md). Org-scoped, Member+. "Open" is idempotent per node
 * (reuses the live investigation); the diagnose loop attaches its verdict via PATCH; the Insights
 * "Past incidents" view reads the list.
 */
@Controller("incidents")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Post()
  @Roles("Member")
  async open(@Req() req: AuthedRequest, @Body() body: OpenBody): Promise<Incident> {
    const orgId = orgOf(req);
    const nodeId = body.nodeId?.trim();
    if (!nodeId) throw ApiException.validation([{ field: "nodeId", issue: "nodeId is required." }]);
    const trigger = (body.trigger ?? "manual") as IncidentTrigger;
    if (!TRIGGERS.has(trigger)) {
      throw ApiException.validation([{ field: "trigger", issue: "Invalid trigger." }]);
    }
    return this.incidents.open(orgId, req.auth?.userId ?? null, { nodeId, trigger });
  }

  @Get()
  @Roles("Member")
  async list(
    @Req() req: AuthedRequest,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<{ incidents: Incident[] }> {
    const orgId = orgOf(req);
    if (status !== undefined && !STATUSES.has(status as IncidentStatus)) {
      throw ApiException.validation([{ field: "status", issue: "Invalid status." }]);
    }
    const n = limit ? Number.parseInt(limit, 10) : undefined;
    const incidents = await this.incidents.list(orgId, {
      ...(status ? { status: status as IncidentStatus } : {}),
      ...(n && Number.isFinite(n) ? { limit: n } : {}),
    });
    return { incidents };
  }

  @Get(":id")
  @Roles("Member")
  async get(@Req() req: AuthedRequest, @Param("id") id: string): Promise<Incident> {
    return this.incidents.get(orgOf(req), id);
  }

  @Patch(":id")
  @Roles("Member")
  async update(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: UpdateBody,
  ): Promise<Incident> {
    if (body.status !== undefined && !STATUSES.has(body.status as IncidentStatus)) {
      throw ApiException.validation([{ field: "status", issue: "Invalid status." }]);
    }
    return this.incidents.update(orgOf(req), id, {
      ...(body.status !== undefined ? { status: body.status as IncidentStatus } : {}),
      ...(body.verdict !== undefined ? { verdict: body.verdict } : {}),
      ...(body.evidence !== undefined ? { evidence: body.evidence } : {}),
      ...(body.resolution !== undefined ? { resolution: body.resolution } : {}),
    });
  }
}

function orgOf(req: AuthedRequest): string {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org.id;
}
