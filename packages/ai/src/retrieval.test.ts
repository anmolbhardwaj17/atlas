import { describe, it, expect } from "vitest";
import { orchestrate } from "./retrieval";
import { buildContext } from "./context";
import { groundingGate } from "./grounding";
import type { RetrievalPort, RetrievedNode, Traversal } from "./retrieval-port";
import type { RetrievalPlan } from "./planner";

const RDS: RetrievedNode = {
  id: "rds1",
  urn: "aws:us-east-1:1:rds:prod-orders",
  kind: "aws.rds.instance",
  name: "prod-orders",
  status: "active",
  confidence: "observed",
  region: "us-east-1",
  provenance: { source: "rds:DescribeDBInstances", rawSnapshotRef: "bucket/x.json" },
};
const TRAVERSAL: Traversal = {
  root: { id: "rds1", urn: RDS.urn, kind: RDS.kind, name: "prod-orders" },
  impacted: [
    {
      node: {
        id: "ecs1",
        urn: "aws:...:ecs-service:prod/orders-api",
        kind: "aws.ecs.service",
        name: "orders-api",
      },
      distance: 1,
      via: [
        {
          edgeId: "e1",
          type: "CONNECTS_TO",
          confidence: "inferred-high",
          evidence: { rule: "sg_correlation_connects@1", detail: "SG :5432" },
          rule: "sg_correlation_connects@1",
        },
      ],
      pathConfidence: "inferred-high",
    },
  ],
  warnings: [],
  truncated: false,
};

function port(overrides: Partial<RetrievalPort> = {}): RetrievalPort {
  return {
    async search() {
      return [{ id: "rds1", kind: "aws.rds.instance", name: "prod-orders", score: 1 }];
    },
    async getNode() {
      return RDS;
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
    ...overrides,
  };
}

const blastPlan: RetrievalPlan = {
  intent: "blast_radius",
  question: "what breaks if prod-orders is deleted",
  entity: {
    mention: "prod-orders",
    candidates: [{ id: "rds1", kind: "aws.rds.instance", name: "prod-orders", score: 1 }],
  },
};

describe("orchestrate", () => {
  it("runs the blast-radius traversal for the resolved entity", async () => {
    const r = await orchestrate(port(), "o", blastPlan);
    expect(r.rootNode?.id).toBe("rds1");
    expect(r.traversal?.impacted).toHaveLength(1);
  });

  it("does no retrieval for out-of-scope / unresolved", async () => {
    const oos = await orchestrate(port(), "o", { intent: "out_of_scope", question: "x" });
    expect(oos.rootNode).toBeUndefined();
    const unresolved = await orchestrate(port(), "o", {
      intent: "lookup",
      question: "ghost",
      entity: { mention: "ghost", candidates: [] },
    });
    expect(unresolved.rootNode).toBeUndefined();
  });
});

describe("buildContext (DD-3 citation-tagged block)", () => {
  it("tags every node/edge with a stable marker + cite id", async () => {
    const r = await orchestrate(port(), "o", blastPlan);
    const { context, cites, nodesConsidered } = buildContext("o", r);
    expect(context).toContain("[CONTEXT — org:o");
    expect(context).toContain("ONLY facts");
    expect(context).toMatch(/N1 \(cite:rds1\)/);
    expect(context).toMatch(/--CONNECTS_TO-->/);
    expect(cites.find((c) => c.id === "e1")).toMatchObject({
      kind: "edge",
      confidence: "inferred-high",
    });
    expect(nodesConsidered).toBe(2); // rds + orders-api
  });
});

describe("groundingGate (DD-4 / US-11)", () => {
  it("grounds a resolved entity", async () => {
    expect(groundingGate(await orchestrate(port(), "o", blastPlan)).grounded).toBe(true);
  });
  it("refuses out-of-scope with a reason", () => {
    const g = groundingGate({ intent: "out_of_scope", mention: null, ambiguous: false });
    expect(g.grounded).toBe(false);
    expect(g.reason).toMatch(/outside the connected graph/);
  });
  it("refuses an unresolved entity (honest-absence)", () => {
    const g = groundingGate({ intent: "lookup", mention: "ghost", ambiguous: false });
    expect(g.grounded).toBe(false);
    expect(g.reason).toMatch(/couldn't find "ghost"/);
  });
  it("grounds timeline even when empty", () => {
    expect(groundingGate({ intent: "timeline", mention: null, ambiguous: false }).grounded).toBe(
      true,
    );
  });
});
