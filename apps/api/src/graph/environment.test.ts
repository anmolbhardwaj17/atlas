import { describe, it, expect } from "vitest";
import { inferEnvironment } from "./environment";

describe("inferEnvironment", () => {
  it("prefers an explicit tag over naming", () => {
    expect(inferEnvironment({ name: "prod-orders", tags: { Environment: "staging" } })).toBe(
      "staging",
    );
  });

  it("reads common tag keys and attribute bags, case-insensitively", () => {
    expect(inferEnvironment({ tags: { env: "Production" } })).toBe("prod");
    expect(inferEnvironment({ attributes: { Stage: "dev" } })).toBe("dev");
    expect(inferEnvironment({ tags: { TIER: "qa" } })).toBe("test");
  });

  it("falls back to naming conventions", () => {
    expect(inferEnvironment({ name: "prod-vpc" })).toBe("prod");
    expect(inferEnvironment({ name: "staging-1a" })).toBe("staging");
    expect(inferEnvironment({ urn: "aws:us-east-1:1:ecs-service/dev-api" })).toBe("dev");
  });

  it("is unknown when nothing indicates an environment", () => {
    expect(inferEnvironment({ name: "orders-db", urn: "aws:us-east-1:1:rds/orders-db" })).toBe(
      "unknown",
    );
  });

  it("does not false-match env tokens inside unrelated words", () => {
    // "provider"/"development" edge cases: bare "provider" must not read as prod.
    expect(inferEnvironment({ name: "provider-registry" })).toBe("unknown");
  });
});
