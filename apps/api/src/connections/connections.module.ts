import { Module, type Provider } from "@nestjs/common";
import { InMemorySecretBroker, MockConnector } from "@atlas/ingest";
import { AuthModule } from "../auth/auth.module";
import { ConnectionService } from "./connection.service";
import { ConnectionController } from "./connection.controller";
import { ConnectorRegistry } from "./connector-registry";
import { SECRET_BROKER } from "./tokens";

/**
 * Connections (docs/08 §8, F2.8). Imports AuthModule for the guards.
 *
 * The Secrets Broker is the in-memory dev impl (F2.6); AWS Secrets Manager is the
 * production impl (docs/13 §7). The ConnectorRegistry is seeded with PLACEHOLDER
 * connectors so the create→verify lifecycle is exercisable now — real AWS/GitHub
 * connectors replace these in I1/I2.
 */
const secretBrokerProvider: Provider = {
  provide: SECRET_BROKER,
  useClass: InMemorySecretBroker,
};

const connectorRegistryProvider: Provider = {
  provide: ConnectorRegistry,
  useFactory: (): ConnectorRegistry => {
    const registry = new ConnectorRegistry();
    // PLACEHOLDERS (verify returns "connected") until I1/I2 implement real connectors.
    registry.register("aws", new MockConnector([]));
    registry.register("github", new MockConnector([]));
    return registry;
  },
};

@Module({
  imports: [AuthModule],
  controllers: [ConnectionController],
  providers: [ConnectionService, secretBrokerProvider, connectorRegistryProvider],
})
export class ConnectionsModule {}
