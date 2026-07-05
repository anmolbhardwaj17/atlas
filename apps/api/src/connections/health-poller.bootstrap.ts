import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import { applyHealthObservations, type SecretBroker } from "@atlas/ingest";
import type { Connection } from "@atlas/connector-sdk";
import type { HealthCollectResult } from "@atlas/connector-aws";
import { PG_POOL, ENV } from "../core/tokens";
import { SECRET_BROKER } from "./tokens";
import { ConnectorRegistry } from "./connector-registry";

/** Structural check: a connector that can run a runtime-health pass (AWS today). */
interface HealthCapable {
  collectHealth(
    conn: Connection,
    secrets: SecretBroker,
    signal?: AbortSignal,
  ): Promise<HealthCollectResult>;
}
function isHealthCapable(c: unknown): c is HealthCapable {
  return typeof (c as HealthCapable | undefined)?.collectHealth === "function";
}

/**
 * Runtime-health poller (operational-intelligence Phase B) — the dev in-process slice,
 * like SyncSchedulerBootstrap. Every tick: list eligible connections cross-org
 * (app_health_targets, SECURITY DEFINER), run each provider's cheap read-only health
 * pass, and annotate the org's nodes (attributes.health) inside org-scoped RLS. This is
 * what keeps the map's red/amber current between crawls. Off unless
 * HEALTH_INTERVAL_MINUTES > 0.
 */
@Injectable()
export class HealthPollerBootstrap implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(HealthPollerBootstrap.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
    private readonly registry: ConnectorRegistry,
  ) {}

  onModuleInit(): void {
    const minutes = this.env.HEALTH_INTERVAL_MINUTES;
    if (!minutes || minutes <= 0) {
      this.logger.log("Health poll disabled (HEALTH_INTERVAL_MINUTES=0).");
      return;
    }
    if (!this.env.SECRET_ENCRYPTION_KEY) {
      this.logger.warn("Health poll needs SECRET_ENCRYPTION_KEY (durable secrets) — skipping.");
      return;
    }
    setTimeout(() => void this.tick(), 15_000);
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    this.logger.log(`Health poll on: every ${minutes} min.`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap ticks
    this.running = true;
    try {
      const { rows } = await this.db.query<{ org_id: string; connection_id: string }>(
        "SELECT org_id, connection_id FROM app_health_targets()",
      );
      for (const r of rows) {
        try {
          await this.checkConnection(r.org_id, r.connection_id);
        } catch (err) {
          this.logger.warn(`health poll skipped ${r.connection_id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`health poll tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async checkConnection(orgId: string, connectionId: string): Promise<void> {
    const conn = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        id: string;
        org_id: string;
        provider: string;
        display_name: string;
        config: Record<string, unknown>;
        secret_ref: string | null;
      }>(
        `SELECT id, org_id, provider, display_name, config, secret_ref
           FROM connections WHERE id = $1 AND deleted_at IS NULL`,
        [connectionId],
      );
      return rows[0];
    });
    if (!conn) return;

    const connector = this.registry.get(conn.provider);
    if (!isHealthCapable(connector)) return;

    const sdkConn: Connection = {
      id: conn.id,
      orgId: conn.org_id,
      provider: conn.provider as Connection["provider"],
      displayName: conn.display_name,
      config: conn.config,
      secretRef: conn.secret_ref,
    };
    const result = await connector.collectHealth(sdkConn, this.secrets);
    const { applied, unmatched } = await applyHealthObservations(
      this.db,
      orgId,
      result.observations,
    );
    const bad = result.observations.filter((o) => o.state !== "healthy").length;
    this.logger.log(
      `health ${conn.display_name}: ${applied} annotated (${bad} not healthy)` +
        (unmatched > 0 ? `, ${unmatched} unmatched` : "") +
        (result.skipped.length > 0
          ? `, skipped: ${result.skipped.map((s) => s.iamAction).join(", ")}`
          : ""),
    );
  }
}
