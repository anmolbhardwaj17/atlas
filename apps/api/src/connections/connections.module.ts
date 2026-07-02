import { Module, type Provider } from "@nestjs/common";
import { InMemorySecretBroker, InMemoryQueue, type SecretBroker } from "@atlas/ingest";
import { createAwsConnector } from "@atlas/connector-aws";
import { createGithubConnector } from "@atlas/connector-github";
import { createBitbucketConnector } from "@atlas/connector-bitbucket";
import { AuthModule } from "../auth/auth.module";
import { ConnectionService } from "./connection.service";
import { ConnectionController } from "./connection.controller";
import { ConnectorRegistry } from "./connector-registry";
import { SyncWorkerBootstrap } from "./sync-worker.bootstrap";
import { SECRET_BROKER, JOB_QUEUE } from "./tokens";

/**
 * Connections (docs/08 §8). Imports AuthModule for the guards.
 *
 * The Secrets Broker is the in-memory dev impl (F2.6); AWS Secrets Manager is the
 * production impl (docs/13 §7). The ConnectorRegistry holds the REAL AwsConnector (I1)
 * and GithubConnector (I2) - verify runs a live AssumeRole / installation-token probe.
 * The JobQueue is the in-memory dev impl (F2.5); a BullMQ/Redis queue + a worker process
 * run jobs in deploy (docs/02 §5) - the API only enqueues.
 */
const secretBrokerProvider: Provider = {
  provide: SECRET_BROKER,
  useClass: InMemorySecretBroker,
};

const jobQueueProvider: Provider = {
  provide: JOB_QUEUE,
  useFactory: (): InMemoryQueue => new InMemoryQueue(),
};

const connectorRegistryProvider: Provider = {
  provide: ConnectorRegistry,
  useFactory: (secrets: SecretBroker): ConnectorRegistry => {
    const registry = new ConnectorRegistry();
    registry.register("aws", createAwsConnector({ secrets }));
    registry.register("github", createGithubConnector({ secrets }));
    registry.register("bitbucket", createBitbucketConnector({ secrets }));
    return registry;
  },
  inject: [SECRET_BROKER],
};

@Module({
  imports: [AuthModule],
  controllers: [ConnectionController],
  providers: [
    ConnectionService,
    secretBrokerProvider,
    jobQueueProvider,
    connectorRegistryProvider,
    SyncWorkerBootstrap,
  ],
})
export class ConnectionsModule {}
