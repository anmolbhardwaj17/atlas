import { Inject, Injectable, Logger } from "@nestjs/common";
import { withOrgScope, type Db, type ConnectionRow } from "@atlas/db";
import type { Connection } from "@atlas/connector-sdk";
import { enqueueSync, type SecretBroker, type JobQueue } from "@atlas/ingest";
import { runInference, ALL_RULES, type InferenceStats } from "@atlas/inference";
import { PG_POOL } from "../core/tokens";
import { ApiException } from "../common/errors";
import { ConnectorRegistry } from "./connector-registry";
import { SECRET_BROKER, JOB_QUEUE } from "./tokens";
import type {
  ConnectionDto,
  CreateConnectionBody,
  LastSyncDto,
  SyncTriggerDto,
  VerifyConnectionBody,
} from "./dto";

const SELECT_COLS = `id, org_id, provider, display_name, status, config, secret_ref, health,
  last_error, last_synced_at, created_at, updated_at, deleted_at`;

/**
 * Connection lifecycle (docs/08 §8, docs/03 §5.1). Org-scoped via withOrgScope (RLS).
 * Credentials go to the Secrets Broker (only the opaque secret_ref is stored, BR-CONN-1).
 * `verify` resolves the provider's connector from the registry; on success it enqueues
 * an onboarding full sync (docs/06 §11, FR-1.5). One in-flight run per connection
 * (BR-SYNC-1) - a duplicate enqueue is a no-op.
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

  /**
   * Re-run the full inference engine over the org's current graph (docs/05 §6.1) WITHOUT a
   * re-crawl. Inference is global + idempotent, so this re-derives every cross-source edge
   * (repo→runtime name-matching, SG/config/IAM correlation, …) from whatever nodes+signals exist
   * right now. Recovery lever for when an edge was dropped (e.g. a source was disconnected +
   * reconnected) but the deterministic signals are present again — no need to wait for the next
   * sync's infer pass. Admin-gated at the controller.
   */
  async reindex(orgId: string): Promise<InferenceStats> {
    const stats = await runInference({ db: this.db }, orgId, ALL_RULES);
    this.logger.log(
      `reindex ${orgId}: ${stats.candidates} candidates, ${stats.upserted} edges upserted, ` +
        `${stats.retired} retired, ${stats.derivedNodes} derived nodes`,
    );
    return stats;
  }

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
      return this.attachSyncInfo(c, rows.map(toDto));
    });
  }

  async get(orgId: string, id: string): Promise<ConnectionDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      const dto = toDto(await this.load(c, id));
      const [enriched] = await this.attachSyncInfo(c, [dto]);
      return enriched ?? dto;
    });
  }

  /**
   * Sync visibility (FR-1.5): mark connections with an in-flight run (`syncing`) and attach
   * the most recent finished run's outcome (`lastSync`) so the hub can show live progress
   * and "last synced X ago · N resources" honestly - a `partial` run is surfaced as such,
   * never dressed up as a full success (P3). Runs inside the caller's org-scoped tx (RLS).
   */
  private async attachSyncInfo(
    c: import("pg").PoolClient,
    dtos: ConnectionDto[],
  ): Promise<ConnectionDto[]> {
    if (dtos.length === 0) return dtos;
    const ids = dtos.map((d) => d.id);

    // Reap orphaned in-flight runs first (self-healing). The dev worker is in-process and the
    // queue in-memory, so an API restart strands a run in queued/running forever - which both
    // renders "Syncing…" as a permanent lie and blocks new runs via uq_sync_inflight (BR-SYNC-1).
    // Detection is STALENESS-based: the staged runner bumps `updated_at` after every scope
    // (checkpoint write), so a live-but-slow sync stays fresh while an orphaned one goes stale.
    // Queued 15+ min without starting, or running with no progress for 15+ min, is dead - finalize
    // it as failed, honestly. (updated_at, not started_at, so a legitimately long sync isn't reaped
    // mid-flight.)
    const reaped = await c.query<{ id: string }>(
      `UPDATE sync_runs
         SET status = 'failed', finished_at = now(),
             scope_result = scope_result || '{"reaped": "in-flight run orphaned (worker lost or restarted)"}'::jsonb
         WHERE connection_id = ANY($1::uuid[])
           AND ((status = 'queued' AND created_at < now() - interval '15 minutes')
             OR (status = 'running' AND updated_at < now() - interval '15 minutes'))
         RETURNING id`,
      [ids],
    );
    for (const r of reaped.rows) this.logger.warn(`reaped orphaned sync_run ${r.id}`);

    const inflight = await c.query<{ connection_id: string }>(
      `SELECT connection_id FROM sync_runs
         WHERE connection_id = ANY($1::uuid[]) AND status IN ('queued', 'running')`,
      [ids],
    );
    const syncingIds = new Set(inflight.rows.map((r) => r.connection_id));

    const finished = await c.query<{
      connection_id: string;
      status: LastSyncDto["status"];
      finished_at: Date;
      stats: Record<string, unknown>;
      scope_result: unknown;
    }>(
      `SELECT DISTINCT ON (connection_id) connection_id, status, finished_at, stats, scope_result
         FROM sync_runs
         WHERE connection_id = ANY($1::uuid[]) AND finished_at IS NOT NULL
         ORDER BY connection_id, finished_at DESC`,
      [ids],
    );
    const lastByConn = new Map<string, LastSyncDto>(
      finished.rows.map((r) => [
        r.connection_id,
        {
          status: r.status,
          finishedAt: r.finished_at.toISOString(),
          resources: Number(r.stats["persisted"] ?? 0),
          edges: Number(r.stats["edges"] ?? 0),
          scopesFailed: Number(r.stats["scopesFailed"] ?? 0),
          // scope_result is the finalize() failedScopes array (string[]); reaped runs store an object.
          skippedScopes: Array.isArray(r.scope_result)
            ? r.scope_result.filter((s): s is string => typeof s === "string")
            : [],
        },
      ]),
    );

    return dtos.map((d) => ({
      ...d,
      syncing: syncingIds.has(d.id),
      lastSync: lastByConn.get(d.id) ?? null,
    }));
  }

  async verify(orgId: string, id: string, body: VerifyConnectionBody): Promise<ConnectionDto> {
    // Store any supplied credentials in the broker first (outside the row's tx).
    let newSecretRef: string | null = null;
    if (body.credentials && Object.keys(body.credentials).length > 0) {
      newSecretRef = await this.secrets.put(orgId, body.credentials);
    }

    // We must PERSIST the failure state (status='error', last_error, and the secret_ref link) even
    // when verify fails — throwing inside the org-scoped tx would roll it back, leaving the
    // connection 'pending' with no stored token and breaking "save now, re-verify later". So the
    // callback RETURNS an outcome (never throws); the 422 is raised after the tx has committed.
    type VerifyOutcome = { ok: true; dto: ConnectionDto } | { ok: false; message: string };
    const outcome = await withOrgScope(this.db, orgId, async (c): Promise<VerifyOutcome> => {
      const row = await this.load(c, id);
      const connector = this.registry.get(row.provider);
      if (!connector) {
        await c.query("UPDATE connections SET status = 'error', last_error = $2 WHERE id = $1", [
          id,
          `No connector available for provider "${row.provider}" yet.`,
        ]);
        return { ok: false, message: `Provider "${row.provider}" is not available yet.` };
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
        return { ok: false, message: result.message ?? "Connection verification failed." };
      }

      const { rows } = await c.query<ConnectionRow>(
        `UPDATE connections SET status = $2, health = $3, last_error = NULL WHERE id = $1
         RETURNING ${SELECT_COLS}`,
        [id, result.status, JSON.stringify(health)],
      );
      return { ok: true, dto: toDto(rows[0]) };
    });

    // The failure state is now committed; surface the 422 to the caller.
    if (!outcome.ok) {
      throw new ApiException(422, "connection_verification_failed", outcome.message);
    }
    // On a usable connection, kick off the onboarding full sync (FR-1.5). Errors are
    // logged internally so they never fail the verify itself.
    if (outcome.dto.status === "connected" || outcome.dto.status === "degraded") {
      await this.enqueueSyncRun(orgId, id, "onboarding");
    }
    return outcome.dto;
  }

  /**
   * Manually trigger a full re-sync ("fetch latest info", FR-1.5). Guards that the source is
   * usable and - critically - that its credentials are still resolvable: the dev Secrets Broker
   * is in-memory, so a `secret_ref` can dangle after an API restart (or if it was seeded by a
   * separate process). Rather than enqueue a sync that would fail auth mid-run, we surface that
   * as a clear "reconnect" error up front. One in-flight run per connection (BR-SYNC-1): if a
   * run is already going we report that instead of duplicating it.
   */
  async triggerSync(orgId: string, id: string): Promise<SyncTriggerDto> {
    const row = await withOrgScope(this.db, orgId, (c) => this.load(c, id));

    if (row.status === "disconnected") {
      throw new ApiException(
        409,
        "invalid_state_transition",
        "This source is disconnected. Reconnect it before syncing.",
      );
    }
    if (!this.registry.get(row.provider)) {
      throw new ApiException(
        422,
        "connection_verification_failed",
        `Provider "${row.provider}" can't sync yet.`,
      );
    }
    // Credentials must still be present in the broker (dangling ref ⇒ reconnect needed).
    const material = row.secret_ref ? await this.secrets.get(row.secret_ref) : {};
    if (Object.keys(material).length === 0) {
      throw new ApiException(
        409,
        "invalid_state_transition",
        "This source's credentials aren't available in this environment. Reconnect it, then sync.",
      );
    }

    // Reference-driven Jira crawl: before syncing, point the crawl at the specific tickets our PRs
    // reference but that a recent-N crawl would miss — so linking scales to any backlog (IV, scale).
    if (row.provider === "jira") {
      const n = await this.refreshJiraBackfillKeys(orgId, id).catch((e: unknown) => {
        this.logger.warn(`jira backfill-key refresh failed for ${id}: ${(e as Error).message}`);
        return 0;
      });
      if (n > 0) this.logger.log(`jira reference-driven crawl: ${n} referenced ticket(s) queued`);
    }

    const { runId, alreadyRunning } = await this.enqueueSyncRun(orgId, id, "manual");
    if (!alreadyRunning && !runId) {
      throw new ApiException(500, "internal_error", "Couldn't start a sync - please retry.");
    }
    return { status: alreadyRunning ? "already_running" : "queued", runId: runId ?? null };
  }

  /**
   * Set `config.backfillKeys` to the Jira ticket keys our PRs reference but haven't been crawled yet
   * (filtered to real project prefixes, so fake timestamp-branches drop out). The next crawl fetches
   * exactly those by key — reference-driven, so it fetches what the code touches, not the whole
   * backlog (scales to enterprise Jira). Returns how many keys were queued.
   */
  private async refreshJiraBackfillKeys(orgId: string, connectionId: string): Promise<number> {
    return withOrgScope(this.db, orgId, async (c) => {
      const projects = new Set(
        (
          await c.query<{ k: string }>(
            `SELECT upper(attributes->>'key') k FROM nodes WHERE kind='jira.project' AND status='active'`,
          )
        ).rows
          .map((r) => r.k)
          .filter(Boolean),
      );
      if (projects.size === 0) return 0;
      const crawled = new Set(
        (
          await c.query<{ k: string }>(
            `SELECT upper(attributes->>'key') k FROM nodes WHERE kind='jira.issue' AND status='active'`,
          )
        ).rows
          .map((r) => r.k)
          .filter(Boolean),
      );
      const prs = (
        await c.query<{ name: string | null; br: string | null }>(
          `SELECT name, attributes->>'sourceBranch' br FROM nodes
            WHERE kind IN ('bitbucket.pullrequest','github.pull_request') AND status='active'`,
        )
      ).rows;
      const KEY = /[A-Z][A-Z0-9]{1,9}-\d+/g;
      const missing = new Set<string>();
      for (const pr of prs) {
        const text = `${pr.name ?? ""} ${pr.br ?? ""}`.toUpperCase();
        for (const k of text.match(KEY) ?? []) {
          const prefix = k.split("-")[0] ?? "";
          if (projects.has(prefix) && !crawled.has(k)) missing.add(k);
        }
      }
      const keys = [...missing].slice(0, 1000);
      await c.query(
        `UPDATE connections
            SET config = jsonb_set(coalesce(config,'{}'::jsonb), '{backfillKeys}', $2::jsonb)
          WHERE id = $1`,
        [connectionId, JSON.stringify(keys)],
      );
      return keys.length;
    });
  }

  /**
   * Create a queued sync_run and enqueue the job (docs/06 §11). BR-SYNC-1 caps one in-flight
   * run per connection via uq_sync_inflight; a conflicting insert (a run already queued/running)
   * is reported as `alreadyRunning` - the existing run covers it. Never throws: infra errors are
   * logged and surface as a missing `runId` so callers can decide whether to raise them.
   */
  private async enqueueSyncRun(
    orgId: string,
    connectionId: string,
    trigger: "onboarding" | "manual",
  ): Promise<{ runId?: string; alreadyRunning: boolean }> {
    let runId: string | undefined;
    try {
      runId = await withOrgScope(this.db, orgId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO sync_runs (org_id, connection_id, type, trigger, status)
           VALUES ($1, $2, 'full', $3, 'queued') RETURNING id`,
          [orgId, connectionId, trigger],
        );
        return rows[0]?.id;
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") return { alreadyRunning: true }; // BR-SYNC-1: a run is already in flight.
      this.logger.error(`failed to create ${trigger} sync_run: ${(err as Error).message}`);
      return { alreadyRunning: false };
    }
    if (!runId) return { alreadyRunning: false };
    try {
      await enqueueSync(this.queue, { orgId, connectionId, runId, type: "full" });
    } catch (err) {
      this.logger.error(`failed to enqueue ${trigger} sync: ${(err as Error).message}`);
    }
    return { runId, alreadyRunning: false };
  }

  async disconnect(orgId: string, id: string): Promise<ConnectionDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      await this.load(c, id); // 404 if absent / cross-tenant
      const purged = await this.purgeGraphData(c, id);
      const { rows } = await c.query<ConnectionRow>(
        `UPDATE connections SET status = 'disconnected', deleted_at = now() WHERE id = $1
         RETURNING ${SELECT_COLS}`,
        [id],
      );
      this.logger.log(
        `Disconnected ${id}: purged ${purged.nodes} nodes (+${purged.derivedNodes} orphaned derived), ` +
          `${purged.edges} edges, ${purged.signals} signals`,
      );
      return toDto(rows[0]);
    });
  }

  /**
   * Purge a source's graph data on disconnect (docs/03, docs/04) - the connection row is
   * kept (soft-deleted) for history/audit, but its graph footprint is removed so a removed
   * source leaves no lingering nodes/edges. Runs in the caller's org-scoped transaction, so
   * RLS confines every delete to this org. Deleting the connection's nodes cascades their
   * incident edges (composite-FK ON DELETE CASCADE, BR-EDGE-1), incl. inferred edges to
   * derived nodes; we then sweep derived nodes (e.g. atlas.service) left with no edges and
   * provenance no surviving edge references, so no dangling artifacts remain.
   */
  private async purgeGraphData(
    c: import("pg").PoolClient,
    connectionId: string,
  ): Promise<{ nodes: number; edges: number; signals: number; derivedNodes: number }> {
    // Count incident edges before the cascade removes them (for the log).
    const edges = Number(
      (
        await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM edges e
             WHERE e.from_node_id IN (SELECT id FROM nodes WHERE connection_id = $1)
                OR e.to_node_id   IN (SELECT id FROM nodes WHERE connection_id = $1)`,
          [connectionId],
        )
      ).rows[0]?.n ?? "0",
    );
    // Detach provenance from the snapshots we're about to delete - the FK is RESTRICT, so a
    // referencing provenance row would block the delete (the row itself is swept below).
    await c.query(
      `UPDATE provenance SET raw_snapshot_id = NULL
         WHERE raw_snapshot_id IN (
           SELECT id FROM raw_snapshots WHERE node_id IN (SELECT id FROM nodes WHERE connection_id = $1)
         )`,
      [connectionId],
    );
    // Snapshots first (node_id would otherwise be SET NULL, orphaning them).
    await c.query(
      `DELETE FROM raw_snapshots WHERE node_id IN (SELECT id FROM nodes WHERE connection_id = $1)`,
      [connectionId],
    );
    const signals =
      (await c.query(`DELETE FROM signals WHERE connection_id = $1`, [connectionId])).rowCount ?? 0;
    // Deleting the source's nodes cascades their edges (composite FK).
    const nodes =
      (await c.query(`DELETE FROM nodes WHERE connection_id = $1`, [connectionId])).rowCount ?? 0;
    // Sweep derived nodes (connection_id IS NULL) now left with no incident edges.
    const derivedNodes =
      (
        await c.query(
          `DELETE FROM nodes n
             WHERE n.connection_id IS NULL
               AND NOT EXISTS (SELECT 1 FROM edges e
                                 WHERE e.from_node_id = n.id OR e.to_node_id = n.id)`,
        )
      ).rowCount ?? 0;
    // Sweep provenance no surviving edge references (provenance is referenced only by edges).
    await c.query(
      `DELETE FROM provenance p WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.provenance_id = p.id)`,
    );
    return { nodes, edges, signals, derivedNodes };
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
    demo: row.config?.demo === true,
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    // Filled by attachSyncInfo on read paths; mutation returns are refreshed by the client.
    syncing: false,
    lastSync: null,
    createdAt: row.created_at.toISOString(),
  };
}
