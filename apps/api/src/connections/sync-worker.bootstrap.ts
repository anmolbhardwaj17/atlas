import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { withOrgScope, type Db } from "@atlas/db";
import {
  InMemorySnapshotStore,
  registerSyncWorker,
  type JobQueue,
  type SecretBroker,
} from "@atlas/ingest";
import type { Connection, ConnectorLogger } from "@atlas/connector-sdk";
import { PG_POOL } from "../core/tokens";
import { GraphService } from "../graph/graph.service";
import { SECRET_BROKER, JOB_QUEUE } from "./tokens";
import { ConnectorRegistry } from "./connector-registry";

/**
 * Dev in-process sync worker (F2.5). In deploy a separate worker process consumes a
 * BullMQ/Redis queue (docs/02 §5); locally the API enqueues onto the in-memory queue and
 * nothing would run it - so here we register the same staged-sync handler in-process so
 * connect → verify → sync → graph works end to end on a laptop. It shares the API's
 * ConnectorRegistry (real connectors) + Secrets Broker (the credentials verify just stored),
 * so no secret ever leaves the process. Raw snapshots use the in-memory store (dev).
 */
@Injectable()
export class SyncWorkerBootstrap implements OnModuleInit {
  private readonly logger = new Logger(SyncWorkerBootstrap.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
    private readonly registry: ConnectorRegistry,
    private readonly graph: GraphService,
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
      snapshots: new InMemorySnapshotStore(),
      secrets: this.secrets,
      logger: log,
      resolveConnector: (provider) => this.registry.get(provider),
      loadConnection: (orgId, connectionId) => this.loadConnection(orgId, connectionId),
      onSyncComplete: async (orgId) => {
        const { active, resolved } = await this.graph.reconcileFindings(orgId);
        this.logger.log(`finding lifecycle reconciled: ${active} open, ${resolved} newly resolved`);
      },
    });
    this.logger.log("In-process sync worker registered (dev).");
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
