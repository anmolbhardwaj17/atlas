import { describe, it, expect } from "vitest";
import type { Connector } from "@atlas/connector-sdk";
import { ConnectorRegistry } from "./connector-registry";

function stub(provider: string): Connector {
  return { provider } as unknown as Connector;
}

describe("ConnectorRegistry", () => {
  it("registers and resolves connectors by provider", () => {
    const r = new ConnectorRegistry();
    r.register("aws", stub("aws"));
    expect(r.get("aws")?.provider).toBe("aws");
  });

  it("returns undefined for an unregistered provider", () => {
    expect(new ConnectorRegistry().get("github")).toBeUndefined();
  });

  it("last registration wins for a provider", () => {
    const r = new ConnectorRegistry();
    r.register("aws", stub("aws-1"));
    r.register("aws", stub("aws-2"));
    expect(r.get("aws")?.provider).toBe("aws-2");
  });
});
