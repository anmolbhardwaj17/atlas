import { Inject, Injectable } from "@nestjs/common";
import { withOrgScope, type Db, type ConnectionRow } from "@atlas/db";
import type { Connection } from "@atlas/connector-sdk";
import type { SecretBroker } from "@atlas/ingest";
import { PG_POOL } from "../core/tokens";
import { ApiException } from "../common/errors";
import { ConnectorRegistry } from "./connector-registry";
import { SECRET_BROKER } from "./tokens";
import type { ConnectionDto, CreateConnectionBody, VerifyConnectionBody } from "./dto";

const SELECT_COLS = `id, org_id, provider, display_name, status, config, secret_ref, health,
  last_error, last_synced_at, created_at, updated_at, deleted_at`;

/**
 * Connection lifecycle (docs/08 §8, docs/03 §5.1). Org-scoped via withOrgScope (RLS).
 * Credentials go to the Secrets Broker (only the opaque secret_ref is stored, BR-CONN-1).
 * `verify` resolves the provider's connector from the registry; provider-specific
 * setup (AWS external-id / GitHub install URL) + initial-sync enqueue arrive in I1/I2/F2.5.
 */
@Injectable()
export class ConnectionService {
  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
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

    return withOrgScope(this.db, orgId, async (c) => {
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
