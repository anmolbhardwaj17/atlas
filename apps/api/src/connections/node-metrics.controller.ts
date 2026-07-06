import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import type { Connection } from "@atlas/connector-sdk";
import type { SecretBroker } from "@atlas/ingest";
import type { MetricSeries } from "@atlas/connector-aws";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import type { AuthedRequest } from "../auth/auth.types";
import { ApiException } from "../common/errors";
import { PG_POOL } from "../core/tokens";
import { SECRET_BROKER } from "./tokens";
import { ConnectorRegistry } from "./connector-registry";

/** Active org resolved by TenantScopeGuard (same shape as the other controllers). */
function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}

/** Structural check: a connector that can fetch on-demand node metrics (AWS today). */
interface MetricsCapable {
  collectMetrics(
    conn: Connection,
    secrets: SecretBroker,
    node: { kind: string; region: string | null; attributes: Record<string, unknown> },
    hours: number,
  ): Promise<MetricSeries[] | null>;
}
function isMetricsCapable(c: unknown): c is MetricsCapable {
  return typeof (c as MetricsCapable | undefined)?.collectMetrics === "function";
}

/**
 * On-demand CloudWatch metrics for one node (operational-intelligence Phase B+). Fetched
 * live from the provider when the user inspects a resource - Atlas persists nothing (the
 * plan's hard boundary: we are not a TSDB; CloudWatch stays the system of record). Member
 * read, org-scoped node lookup (RLS → cross-tenant is a 404).
 */
@Controller("nodes")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class NodeMetricsController {
  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
    private readonly registry: ConnectorRegistry,
  ) {}

  @Get(":id/metrics")
  @Roles("Member")
  async metrics(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
  ): Promise<{ supported: boolean; series: MetricSeries[] }> {
    const orgId = org(req).id;
    const found = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        kind: string;
        region: string | null;
        attributes: Record<string, unknown>;
        provider: string;
      }>(
        `SELECT kind, region, attributes, provider FROM nodes
          WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!rows[0]) return null;
      const conn = await c.query<{
        id: string;
        org_id: string;
        provider: string;
        display_name: string;
        config: Record<string, unknown>;
        secret_ref: string | null;
      }>(
        `SELECT id, org_id, provider, display_name, config, secret_ref FROM connections
          WHERE provider = $1 AND deleted_at IS NULL
            AND status IN ('connected', 'degraded') AND secret_ref IS NOT NULL
          ORDER BY created_at LIMIT 1`,
        [rows[0].provider],
      );
      return { node: rows[0], conn: conn.rows[0] ?? null };
    });
    if (!found) throw new ApiException(404, "not_found", "No such resource.");

    const connector = found.conn ? this.registry.get(found.conn.provider) : undefined;
    if (!found.conn || !isMetricsCapable(connector)) return { supported: false, series: [] };

    const sdkConn: Connection = {
      id: found.conn.id,
      orgId: found.conn.org_id,
      provider: found.conn.provider as Connection["provider"],
      displayName: found.conn.display_name,
      config: found.conn.config,
      secretRef: found.conn.secret_ref,
    };
    const series = await connector.collectMetrics(sdkConn, this.secrets, found.node, 24);
    if (series === null) return { supported: false, series: [] };
    return { supported: true, series };
  }
}
