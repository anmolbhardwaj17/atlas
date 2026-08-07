import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import {
  registerSyncWorker,
  type JobQueue,
  type SecretBroker,
  type SnapshotStore,
} from "@atlas/ingest";
import type { Connection, ConnectorLogger } from "@atlas/connector-sdk";
import { PG_POOL } from "../core/tokens";
import { GraphService } from "../graph/graph.service";
import { SECRET_BROKER, JOB_QUEUE, SNAPSHOT_STORE } from "./tokens";
import { ConnectorRegistry } from "./connector-registry";
import { MetricsService } from "../observability/metrics.service";

/**
 * Dev in-process sync worker (F2.5). In deploy a separate worker process consumes a
 * BullMQ/Redis queue (docs/02 §5); locally the API enqueues onto the in-memory queue and
 * nothing would run it - so here we register the same staged-sync handler in-process so
 * connect → verify → sync → graph works end to end on a laptop. It shares the API's
 * ConnectorRegistry (real connectors) + Secrets Broker (the credentials verify just stored),
 * so no secret ever leaves the process. Raw snapshots use the in-memory store (dev).
 */
@Injectable()
export class SyncWorkerBootstrap implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SyncWorkerBootstrap.name);

  /** Polls queue depth for the `atlas_sync_queue_depth` gauge (cleared on shutdown). */
  private depthTimer?: ReturnType<typeof setInterval>;

  /** On SIGTERM (deploy/scale-down), close the queue: BullMQ's worker.close() waits for in-flight
   *  jobs to finish before resolving, so a sync mid-flight completes instead of being lost. */
  async onApplicationShutdown(): Promise<void> {
    if (this.depthTimer) clearInterval(this.depthTimer);
    try {
      await this.queue.close();
      this.logger.log("job queue closed (in-flight jobs drained)");
    } catch (e) {
      this.logger.error(`job queue close failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
    @Inject(SNAPSHOT_STORE) private readonly snapshots: SnapshotStore,
    private readonly registry: ConnectorRegistry,
    private readonly graph: GraphService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    const log: ConnectorLogger = {
      debug: (m) => this.logger.debug(m),
      info: (m) => this.logger.log(m),
      warn: (m) => this.logger.warn(m),
      error: (m) => this.logger.error(m),
    };
    registerSyncWorker(this.queue, {
      db: this.db,
      snapshots: this.snapshots,
      secrets: this.secrets,
      logger: log,
      resolveConnector: (provider) => this.registry.get(provider),
      loadConnection: (orgId, connectionId) => this.loadConnection(orgId, connectionId),
      onJobResult: (outcome) => this.metrics.recordSyncJob(outcome),
      onSyncComplete: async (orgId) => {
        const { active, resolved } = await this.graph.reconcileFindings(orgId);
        this.logger.log(`finding lifecycle reconciled: ${active} open, ${resolved} newly resolved`);
        // Re-apply GDPR erasures — a re-crawl may have re-ingested an erased person's name.
        const rr = await this.graph.reapplyErasures(orgId);
        if (rr > 0) this.logger.log(`re-applied ${rr} identity erasure(s) after sync`);
      },
    });
    this.logger.log("In-process sync worker registered (dev).");

    // Publish queue depth for the backlog metric. Best-effort + unref'd so it never keeps the
    // process alive or lets a transient queue error escape into an unhandled rejection.
    if (this.queue.depth) {
      const poll = (): void => {
        this.queue
          .depth?.()
          .then((d) => {
            this.metrics.setQueueDepth("waiting", d.waiting);
            this.metrics.setQueueDepth("active", d.active);
            this.metrics.setQueueDepth("failed", d.failed);
          })
          .catch(() => undefined);
      };
      poll();
      // 5 minutes, down from 15 SECONDS. Each tick is several Redis commands (getJobCounts fans out
      // per state), so at 15s this alone was ~29k commands/day per instance — the single largest
      // consumer on an idle deployment, on a Redis that bills per command. Nothing is lost: the only
      // consumer is the `atlas_sync_queue_depth` gauge, and its alert fires on a 15-minute window
      // (deploy/prometheus-alerts.yml), so a 5-minute sample is still three times finer than the
      // thing that reads it.
      this.depthTimer = setInterval(poll, 300_000);
      this.depthTimer.unref?.();
    }
  }

  private async loadConnection(orgId: string, connectionId: string): Promise<Connection | null> {
    return withOrgScope(this.db, orgId, async (c) => {
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
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id,
        orgId: r.org_id,
        provider: r.provider as Connection["provider"],
        displayName: r.display_name,
        config: r.config,
        secretRef: r.secret_ref,
      };
    });
  }
}
