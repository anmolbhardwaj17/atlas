import { Module, Logger, type Provider } from "@nestjs/common";
import {
  InMemorySecretBroker,
  DbSecretBroker,
  InMemoryQueue,
  InMemorySnapshotStore,
  SupabaseStorageSnapshotStore,
  createServiceClient,
  RAW_SNAPSHOT_BUCKET,
  type SecretBroker,
  type SnapshotStore,
} from "@atlas/ingest";
import type { Env } from "@atlas/config";
import type { Db } from "@atlas/db";
import { createAwsConnector } from "@atlas/connector-aws";
import { createGithubConnector } from "@atlas/connector-github";
import { createBitbucketConnector } from "@atlas/connector-bitbucket";
import { createJenkinsConnector } from "@atlas/connector-jenkins";
import { createJiraConnector } from "@atlas/connector-jira";
import { AuthModule } from "../auth/auth.module";
import { GraphModule } from "../graph/graph.module";
import { IncidentsModule } from "../incidents/incidents.module";
import { ENV, PG_POOL } from "../core/tokens";
import { ConnectionService } from "./connection.service";
import { NodeMetricsController } from "./node-metrics.controller";
import { ConnectionController } from "./connection.controller";
import { ConnectorRegistry } from "./connector-registry";
import { SyncWorkerBootstrap } from "./sync-worker.bootstrap";
import { HealthPollerBootstrap } from "./health-poller.bootstrap";
import { SyncSchedulerBootstrap } from "./sync-scheduler.bootstrap";
import { SyncReaperBootstrap } from "./sync-reaper.bootstrap";
import { RetentionService } from "./retention.service";
import { RetentionBootstrap } from "./retention.bootstrap";
import { SECRET_BROKER, JOB_QUEUE, SNAPSHOT_STORE } from "./tokens";

/**
 * Connections (docs/08 §8). Imports AuthModule for the guards.
 *
 * The Secrets Broker is the in-memory dev impl (F2.6); AWS Secrets Manager is the
 * production impl (docs/13 §7). The ConnectorRegistry holds the REAL AwsConnector (I1)
 * and GithubConnector (I2) - verify runs a live AssumeRole / installation-token probe.
 * The JobQueue is the in-memory dev impl (F2.5); a BullMQ/Redis queue + a worker process
 * run jobs in deploy (docs/02 §5) - the API only enqueues.
 */
// Durable encrypted store when SECRET_ENCRYPTION_KEY is set (credentials survive restarts, so
// Fetch latest works without reconnecting); otherwise the in-memory dev broker (wiped on boot).
const secretBrokerProvider: Provider = {
  provide: SECRET_BROKER,
  useFactory: (env: Env, db: Db): SecretBroker => {
    if (env.SECRET_ENCRYPTION_KEY) {
      new Logger("SecretBroker").log("Using durable DB-backed secret store (encrypted).");
      return new DbSecretBroker(db, env.SECRET_ENCRYPTION_KEY);
    }
    new Logger("SecretBroker").warn("SECRET_ENCRYPTION_KEY unset - using in-memory broker (dev).");
    return new InMemorySecretBroker();
  },
  inject: [ENV, PG_POOL],
};

const jobQueueProvider: Provider = {
  provide: JOB_QUEUE,
  useFactory: (): InMemoryQueue => new InMemoryQueue(),
};

// Supabase Storage when the service-role key is configured (the durable prod store), else the
// in-memory dev store. One shared instance so writes (sync worker) and deletes (disconnect /
// org-delete) hit the same place — the erasure paths depend on it.
const snapshotStoreProvider: Provider = {
  provide: SNAPSHOT_STORE,
  useFactory: (env: Env): SnapshotStore => {
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      new Logger("SnapshotStore").log("Using Supabase Storage for raw snapshots.");
      const client = createServiceClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
      return new SupabaseStorageSnapshotStore(client, RAW_SNAPSHOT_BUCKET);
    }
    new Logger("SnapshotStore").warn(
      "Supabase Storage unset - using in-memory snapshot store (dev).",
    );
    return new InMemorySnapshotStore();
  },
  inject: [ENV],
};

const connectorRegistryProvider: Provider = {
  provide: ConnectorRegistry,
  useFactory: (secrets: SecretBroker): ConnectorRegistry => {
    const registry = new ConnectorRegistry();
    registry.register("aws", createAwsConnector({ secrets }));
    registry.register("github", createGithubConnector({ secrets }));
    registry.register("bitbucket", createBitbucketConnector({ secrets }));
    registry.register("jenkins", createJenkinsConnector({ secrets }));
    registry.register("jira", createJiraConnector({ secrets }));
    return registry;
  },
  inject: [SECRET_BROKER],
};

@Module({
  imports: [AuthModule, GraphModule, IncidentsModule],
  controllers: [ConnectionController, NodeMetricsController],
  providers: [
    ConnectionService,
    secretBrokerProvider,
    jobQueueProvider,
    snapshotStoreProvider,
    connectorRegistryProvider,
    SyncWorkerBootstrap,
    SyncSchedulerBootstrap,
    SyncReaperBootstrap,
    HealthPollerBootstrap,
    RetentionService,
    RetentionBootstrap,
  ],
  // SECRET_BROKER: so the AI module can resolve per-org BYO-LLM keys through the same broker.
  // ConnectionService: so the demo module can reuse disconnect()'s graph purge to clear sample data.
  // SNAPSHOT_STORE: so the orgs module can erase an org's raw snapshots on delete.
  exports: [SECRET_BROKER, SNAPSHOT_STORE, ConnectionService],
})
export class ConnectionsModule {}
