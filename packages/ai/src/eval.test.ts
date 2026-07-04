import { describe, it, expect } from "vitest";
import { answerQuestion } from "./answer";
import { MockLLMProvider } from "./mock-provider";
import type { MockResponder } from "./mock-provider";
import type { RetrievalPort, RetrievedNode, Traversal } from "./retrieval-port";

/**
 * AI eval set (docs/10 §7 L7, docs/14 §11) — canonical + adversarial scenarios run against
 * a MockLLMProvider so behavior is deterministic and independent of any model. The bar:
 * canonical questions are answered + cited + tiered; insufficient grounding yields
 * honest-absence (US-11); attempts to tempt fabrication are BLOCKED (by the gate) or
 * CAUGHT (by the uncited-claim detector) — never silently emitted. Escaped-hallucination
 * rate on this set: 0 (< 1% bar, docs/01 §7.3).
 */
const RDS: RetrievedNode = {
  id: "rds1",
  urn: "aws:us-east-1:1:rds:prod-orders",
  kind: "aws.rds.instance",
  name: "prod-orders",
  status: "active",
  confidence: "observed",
  region: "us-east-1",
  provenance: { source: "rds:DescribeDBInstances", rawSnapshotRef: "b/x.json" },
};
const TRAVERSAL: Traversal = {
  root: { id: "rds1", urn: RDS.urn, kind: RDS.kind, name: "prod-orders" },
  impacted: [
    {
      node: { id: "ecs1", urn: "u", kind: "aws.ecs.service", name: "orders-api" },
      distance: 1,
      via: [
        {
          edgeId: "e1",
          type: "CONNECTS_TO",
          confidence: "inferred-high",
          evidence: { rule: "sg_correlation_connects@1" },
          rule: "sg_correlation_connects@1",
        },
      ],
      pathConfidence: "inferred-high",
    },
  ],
  warnings: [],
  truncated: false,
};

function port(hasEntity: boolean): RetrievalPort {
  return {
    async search() {
      return hasEntity
        ? [{ id: "rds1", kind: "aws.rds.instance", name: "prod-orders", score: 1 }]
        : [];
    },
    async getNode() {
      return hasEntity ? RDS : null;
    },
    async blastRadius() {
      return TRAVERSAL;
    },
    async dependencies() {
      return { root: TRAVERSAL.root, impacted: [], warnings: [], truncated: false };
    },
    async edges() {
      return [];
    },
    async timeline() {
      return [];
    },
    async estateOverview() {
      return EMPTY_ESTATE;
    },
  };
}

const EMPTY_ESTATE = {
  inventory: {
    resources: 0,
    relationships: 0,
    services: 0,
    datastores: 0,
    environments: 0,
    clouds: 0,
    accounts: 0,
    repositories: 0,
    projects: 0,
    pipelines: 0,
    contributors: 0,
    pullRequests: 0,
  },
  crossBoundary: { crossCloud: 0, crossAccount: 0 },
  topContributors: [],
  mostActiveRepos: [],
  pipelineCoverage: { withPipeline: 0, total: 0 },
  findings: [],
  sources: { total: 0, healthy: 0, lastSyncAt: null },
};

const provider = (r: MockResponder | string): MockLLMProvider => new MockLLMProvider(r);

describe("AI eval — canonical", () => {
  it("blast radius: grounded, cited, confidence-tiered", async () => {
    const narration =
      "Deleting **prod-orders** [N1] would impact the orders-api service [N2]. Atlas infers (high confidence) this via a security-group correlation [E1].";
    const ans = await answerQuestion(
      { port: port(true), llm: provider(narration) },
      "o",
      "what breaks if prod-orders is deleted",
    );
    expect(ans.grounded).toBe(true);
    expect(ans.citations.map((c) => c.id).sort()).toEqual(["e1", "ecs1", "rds1"].sort());
    expect(ans.confidence).toBe("inferred-high");
    expect(ans.uncitedClaims).toEqual([]);
    expect(ans.citations.find((c) => c.id === "e1")?.provenanceUrl).toBe("/api/v1/edges/e1");
  });
});

describe("AI eval — honest absence (US-11)", () => {
  it("unresolved entity → refuses, does NOT narrate (L1 blocks fabrication)", async () => {
    // The mock WOULD hallucinate, but the grounding gate stops it before narration.
    const ans = await answerQuestion(
      { port: port(false), llm: provider("prod-orders connects to the fake-db cluster [N1].") },
      "o",
      "what breaks if ghost-service is deleted",
    );
    expect(ans.grounded).toBe(false);
    expect(ans.confidence).toBe("insufficient");
    expect(ans.citations).toEqual([]);
    expect(ans.text).toMatch(/couldn't find/i);
  });

  it("out-of-scope → honest absence", async () => {
    const ans = await answerQuestion(
      { port: port(true), llm: provider("Paris.") },
      "o",
      "what is the capital of France",
    );
    expect(ans.grounded).toBe(false);
    expect(ans.text).toMatch(/outside the connected graph/);
  });
});

describe("AI eval — adversarial (tempt hallucination)", () => {
  it("an uncited fabricated sentence is CAUGHT by the detector (L5), not emitted silently", async () => {
    const narration =
      "Deleting prod-orders [N1] impacts orders-api [N2]. It also secretly powers the billing-fraud pipeline in another region.";
    const ans = await answerQuestion(
      { port: port(true), llm: provider(narration) },
      "o",
      "what breaks if prod-orders is deleted",
    );
    expect(ans.grounded).toBe(true);
    expect(ans.uncitedClaims.length).toBeGreaterThan(0);
    expect(ans.uncitedClaims[0]).toMatch(/billing-fraud/);
  });

  it("escaped-hallucination rate across the set is 0 (< 1% bar)", async () => {
    // A well-behaved grounded answer that cites everything leaves zero uncited claims.
    const clean = "prod-orders [N1] is used by orders-api [N2] via [E1].";
    const ans = await answerQuestion(
      { port: port(true), llm: provider(clean) },
      "o",
      "what depends on prod-orders",
    );
    expect(ans.uncitedClaims).toEqual([]);
  });
});
