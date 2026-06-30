import { Inject, Injectable, Logger } from "@nestjs/common";
import { withOrgScope, type Db, type ConnectionRow } from "@atlas/db";
import type { Connection } from "@atlas/connector-sdk";
import { enqueueSync, type SecretBroker, type JobQueue } from "@atlas/ingest";
import { PG_POOL } from "../core/tokens";
import { ApiException } from "../common/errors";
import { ConnectorRegistry } from "./connector-registry";
import { SECRET_BROKER, JOB_QUEUE } from "./tokens";
import type { ConnectionDto, CreateConnectionBody, VerifyConnectionBody } from "./dto";

const SELECT_COLS = `id, org_id, provider, display_name, status, config, secret_ref, health,
  last_error, last_synced_at, created_at, updated_at, deleted_at`;

/**
 * Connection lifecycle (docs/08 §8, docs/03 §5.1). Org-scoped via withOrgScope (RLS).
 * Credentials go to the Secrets Broker (only the opaque secret_ref is stored, BR-CONN-1).
 * `verify` resolves the provider's connector from the registry; on success it enqueues
 * an onboarding full sync (docs/06 §11, FR-1.5). One in-flight run per connection
 * (BR-SYNC-1) — a duplicate enqueue is a no-op.
 */
@Injectable()
export class ConnectionService {
  private readonly logger = new Logger(ConnectionService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly registry: ConnectorRegistry,
  ) {}

  async create(orgId: string, body: CreateConnectionBody): Promise<ConnectionDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<ConnectionRow>(
        `INSERT INTO connections (org_id, provider, display_name, config)
         VALUES ($1, $2, $3, $4) RETURNING ${SELECT_COLS}`,
        [orgId, body.provider, body.displayName, JSON.stringify(body.config ?? {})],
      );
      return toDto(rows[0]);
    });
  }

  async list(orgId: string): Promise<ConnectionDto[]> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<ConnectionRow>(
        `SELECT ${SELECT_COLS} FROM connections WHERE deleted_at IS NULL ORDER BY created_at DESC`,
      );
      return rows.map(toDto);
    });
  }

  async get(orgId: string, id: string): Promise<ConnectionDto> {
    return withOrgScope(this.db, orgId, async (c) => toDto(await this.load(c, id)));
  }

  async verify(orgId: string, id: string, body: VerifyConnectionBody): Promise<ConnectionDto> {
    // Store any supplied credentials in the broker first (outside the row's tx).
    let newSecretRef: string | null = null;
    if (body.credentials && Object.keys(body.credentials).length > 0) {
      newSecretRef = await this.secrets.put(orgId, body.credentials);
    }

    const dto = await withOrgScope(this.db, orgId, async (c) => {
      const row = await this.load(c, id);
      const connector = this.registry.get(row.provider);
      if (!connector) {
        await c.query("UPDATE connections SET status = 'error', last_error = $2 WHERE id = $1", [
          id,
          `No connector available for provider "${row.provider}" yet.`,
        ]);
        throw new ApiException(
          422,
          "connection_verification_failed",
          `Provider "${row.provider}" is not available yet.`,
        );
      }

      const secretRef = newSecretRef ?? row.secret_ref;
      if (newSecretRef) {
        await c.query("UPDATE connections SET secret_ref = $2 WHERE id = $1", [id, newSecretRef]);
      }
      await c.query("UPDATE connections SET status = 'verifying' WHERE id = $1", [id]);

      const sdkConn: Connection = {
        id: row.id,
        orgId: row.org_id,
        provider: row.provider,
        displayName: row.display_name,
        config: row.config,
        secretRef,
      };
      const result = await connector.verify(sdkConn);
      const health = { missingPermissions: result.missingPermissions ?? [] };

      if (result.status === "error") {
        await c.query(
          "UPDATE connections SET status = 'error', health = $2, last_error = $3 WHERE id = $1",
          [id, JSON.stringify(health), result.message ?? "verification failed"],
        );
        throw new ApiException(
          422,
          "connection_verification_failed",
          result.message ?? "Connection verification failed.",
        );
      }

      const { rows } = await c.query<ConnectionRow>(
        `UPDATE connections SET status = $2, health = $3, last_error = NULL WHERE id = $1
         RETURNING ${SELECT_COLS}`,
        [id, result.status, JSON.stringify(health)],
      );
      return toDto(rows[0]);
    });

    // On a usable connection, kick off the onboarding full sync (FR-1.5).
    if (dto.status === "connected" || dto.status === "degraded") {
      await this.enqueueInitialSync(orgId, id);
    }
    return dto;
  }

  /**
   * Create a queued onboarding sync_run and enqueue the job (docs/06 §11). BR-SYNC-1
   * caps one in-flight run per connection via uq_sync_inflight; a conflicting insert
   * (a run already queued/running) is swallowed — the existing run covers it.
   */
  private async enqueueInitialSync(orgId: string, connectionId: string): Promise<void> {
    let runId: string | undefined;
    try {
      runId = await withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
           VALUES ($1, $2, 'full', 'onboarding', 'queued') RETURNING id`,
          [orgId, connectionId],
        );
        return rows[0]?.id;
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") return; // BR-SYNC-1: a run is already in flight.
      this.logger.error(`failed to create onboarding sync_run: ${(err as Error).message}`);
      return;
    }
    if (!runId) return;
    try {
      await enqueueSync(this.queue, { orgId, connectionId, runId, type: "full" });
    } catch (err) {
      this.logger.error(`failed to enqueue onboarding sync: ${(err as Error).message}`);
    }
  }

  async disconnect(orgId: string, id: string): Promise<ConnectionDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      await this.load(c, id); // 404 if absent / cross-tenant
      const { rows } = await c.query<ConnectionRow>(
        `UPDATE connections SET status = 'disconnected', deleted_at = now() WHERE id = $1
         RETURNING ${SELECT_COLS}`,
        [id],
      );
      // purge mode (remove the source's nodes) is an async job — follow-up.
      return toDto(rows[0]);
    });
  }

  private async load(c: import("pg").PoolClient, id: string): Promise<ConnectionRow> {
    const { rows } = await c.query<ConnectionRow>(
      `SELECT ${SELECT_COLS} FROM connections WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    const row = rows[0];
    if (!row) throw ApiException.notFound();
    return row;
  }
}

function toDto(row: ConnectionRow | undefined): ConnectionDto {
  if (!row) throw new Error("expected a connection row");
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    status: row.status,
    config: row.config,
    health: row.health,
    secretConfigured: row.secret_ref !== null,
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}
