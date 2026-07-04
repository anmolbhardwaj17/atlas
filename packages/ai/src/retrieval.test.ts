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
    async estateOverview() {
      return ESTATE;
    },
    ...overrides,
  };
}

const ESTATE = {
  inventory: {
    resources: 45,
    relationships: 60,
    services: 3,
    datastores: 2,
    environments: 2,
    clouds: 1,
    accounts: 1,
    repositories: 12,
    projects: 2,
    pipelines: 8,
    contributors: 7,
    pullRequests: 5,
  },
  crossBoundary: { crossCloud: 0, crossAccount: 0 },
  topContributors: [
    { name: "Sahil Saleem", count: 14 },
    { name: "Anmol", count: 9 },
  ],
  mostActiveRepos: [{ name: "gpt-idor-service", count: 9 }],
  pipelineCoverage: { withPipeline: 8, total: 12 },
  findings: [
    { title: "4 repositories have no CI/CD pipeline", severity: "medium", category: "Code hygiene", count: 4 },
  ],
  sources: { total: 2, healthy: 2, lastSyncAt: "2026-07-04T10:00:00Z" },
};

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

describe("estate (P0 aggregate slice)", () => {
  it("loads the whole-org snapshot for the estate intent", async () => {
    const r = await orchestrate(port(), "o", { intent: "estate", question: "how many repos" });
    expect(r.estate?.inventory.repositories).toBe(12);
    expect(r.estate?.topContributors[0]?.name).toBe("Sahil Saleem");
  });

  it("builds grounded, cited estate context (computed A-markers)", async () => {
    const r = await orchestrate(port(), "o", { intent: "estate", question: "top contributors" });
    expect(groundingGate(r).grounded).toBe(true);
    const built = buildContext("o", r);
    expect(built.context).toContain("ESTATE OVERVIEW");
    expect(built.context).toContain("Sahil Saleem=14");
    expect(built.context).toContain("8 of 12 repositories have a CI/CD pipeline");
    expect(built.cites.some((c) => c.kind === "computed" && c.marker === "A1")).toBe(true);
  });

  it("refuses honestly when the snapshot fails to load", () => {
    const g = groundingGate({ intent: "estate", mention: null, ambiguous: false });
    expect(g.grounded).toBe(false);
    expect(g.reason).toMatch(/estate overview/);
  });
});
