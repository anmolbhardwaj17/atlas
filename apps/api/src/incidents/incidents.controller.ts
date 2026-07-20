import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import type { AuthedRequest } from "../auth/auth.types";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import {
  IncidentsService,
  type Incident,
  type IncidentStatus,
  type IncidentTrigger,
} from "./incidents.service";

const STATUSES = new Set<IncidentStatus>(["open", "analyzing", "resolved", "dismissed"]);

// Strict, size-capped body schemas (validate at the edge; reject extra fields → no mass-assignment;
// cap the persisted JSON so a request can't stash an unbounded blob on an incident row).
const boundedJson = z
  .unknown()
  .refine((v) => JSON.stringify(v ?? null).length <= 32_000, "value too large (max 32 KB)");
const OpenSchema = z
  .object({
    nodeId: z.string().trim().min(1).max(200),
    trigger: z.enum(["map", "finding", "alert", "manual"]).default("manual"),
  })
  .strict();
const UpdateSchema = z
  .object({
    status: z.enum(["open", "analyzing", "resolved", "dismissed"]).optional(),
    verdict: boundedJson.optional(),
    evidence: boundedJson.optional(),
    resolution: z.string().max(4000).nullable().optional(),
  })
  .strict();

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
  async open(@Req() req: AuthedRequest, @Body() body: unknown): Promise<Incident> {
    const orgId = orgOf(req);
    const { nodeId, trigger } = parseBody(OpenSchema, body);
    return this.incidents.open(orgId, req.auth?.userId ?? null, {
      nodeId,
      trigger: trigger as IncidentTrigger,
    });
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
    @Body() body: unknown,
  ): Promise<Incident> {
    const parsed = parseBody(UpdateSchema, body);
    return this.incidents.update(orgOf(req), id, {
      ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      ...(parsed.verdict !== undefined ? { verdict: parsed.verdict } : {}),
      ...(parsed.evidence !== undefined ? { evidence: parsed.evidence } : {}),
      ...(parsed.resolution !== undefined ? { resolution: parsed.resolution } : {}),
    });
  }
}

function orgOf(req: AuthedRequest): string {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org.id;
}
