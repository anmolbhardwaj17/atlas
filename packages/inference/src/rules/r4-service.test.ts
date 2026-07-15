import { describe, it, expect } from "vitest";
import { serviceDerivationRule } from "./r4-service";
import type { EdgeLite, InferenceInput } from "../types";

function makeInput(inferredEdges: EdgeLite[]): InferenceInput {
  return {
    orgSlug: "acme",
    nodesByUrn: new Map(),
    nodesByKind: new Map(),
    signals: [],
    signalsByKind: new Map(),
    observedEdges: [],
    inferredEdges,
  };
}
const deploys = (
  repoUrn: string,
  runtimeUrn: string,
  tier: EdgeLite["tier"] = "inferred-high",
): EdgeLite => ({ type: "DEPLOYS_TO", fromUrn: repoUrn, toUrn: runtimeUrn, tier });

const REPO = "github:acme/orders";
const RUNTIME = "aws:us-east-1:1:lambda:orders";
const SERVICE = "atlas:acme:service:orders";

describe("R4 service_derivation", () => {
  it("a high-confidence DEPLOYS_TO derives one atlas.service + IMPLEMENTS + RUNS", () => {
    const out = serviceDerivationRule.evaluate(makeInput([deploys(REPO, RUNTIME)]));

    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]).toMatchObject({
      urn: SERVICE,
      kind: "atlas.service",
      displayName: "orders",
      tier: "inferred-high",
    });
    expect(out.edges).toEqual([
      expect.objectContaining({ type: "IMPLEMENTS", fromUrn: REPO, toUrn: SERVICE }),
      expect.objectContaining({ type: "RUNS", fromUrn: RUNTIME, toUrn: SERVICE }),
    ]);
  });

  it("a LOW-confidence deploy derives NOTHING (DD-1 — a service is only as trustworthy as its deploy)", () => {
    const out = serviceDerivationRule.evaluate(makeInput([deploys(REPO, RUNTIME, "inferred-low")]));
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });

  it("two runtimes deploying the same repo ⇒ ONE service node, two RUNS edges", () => {
    const RUNTIME_2 = "aws:us-east-1:1:ecs:orders-worker";
    const out = serviceDerivationRule.evaluate(
      makeInput([deploys(REPO, RUNTIME), deploys(REPO, RUNTIME_2)]),
    );
    expect(out.nodes).toHaveLength(1); // service is deduped by urn
    const runs = out.edges.filter((e) => e.type === "RUNS");
    const implements_ = out.edges.filter((e) => e.type === "IMPLEMENTS");
    expect(runs.map((e) => e.fromUrn).sort()).toEqual([RUNTIME_2, RUNTIME].sort());
    expect(implements_).toHaveLength(1); // repo→service emitted once
  });

  it("ignores non-deploy inferred edges", () => {
    const out = serviceDerivationRule.evaluate(
      makeInput([{ type: "CONNECTS_TO", fromUrn: RUNTIME, toUrn: REPO, tier: "inferred-high" }]),
    );
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });
});
