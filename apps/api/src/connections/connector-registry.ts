import { Injectable } from "@nestjs/common";
import type { Connector, ConnectorProvider } from "@atlas/connector-sdk";

/**
 * Maps a provider id → its Connector implementation (docs/06 DD-1). The connection
 * `verify`/sync paths resolve the connector here, never importing a provider SDK
 * directly. Real AWS/GitHub connectors are registered in I1/I2; until then the
 * ConnectionsModule registers placeholders so the lifecycle is exercisable in dev.
 */
@Injectable()
export class ConnectorRegistry {
  private readonly connectors = new Map<string, Connector>();

  register(provider: ConnectorProvider, connector: Connector): void {
    this.connectors.set(provider, connector);
  }

  get(provider: string): Connector | undefined {
    return this.connectors.get(provider);
  }
}
