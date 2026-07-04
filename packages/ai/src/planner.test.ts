import { describe, it, expect } from "vitest";
import { classifyIntent, extractTerms, resolveEntity, plan } from "./planner";
import type { RetrievalPort, SearchHit } from "./retrieval-port";

/** Fake port: substring name match, like the Postgres search provider. */
function fakePort(nodes: Array<{ id: string; kind: string; name: string }>): RetrievalPort {
  return {
    async search(_org, q, limit): Promise<SearchHit[]> {
      const term = q.toLowerCase();
      return nodes
        .filter((n) => n.name.toLowerCase().includes(term))
        .map((n) => ({
          id: n.id,
          kind: n.kind,
          name: n.name,
          score: n.name.toLowerCase() === term ? 1 : 0.6,
        }))
        .slice(0, limit);
    },
    async getNode() {
      return null;
    },
    async blastRadius() {
      return {
        root: { id: "", urn: "", kind: "", name: null },
        impacted: [],
        warnings: [],
        truncated: false,
      };
    },
    async dependencies() {
      return {
        root: { id: "", urn: "", kind: "", name: null },
        impacted: [],
        warnings: [],
        truncated: false,
      };
    },
    async edges() {
      return [];
    },
    async timeline() {
      return [];
    },
    async estateOverview() {
      return {
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
    },
  };
}

describe("classifyIntent (canonical questions, docs/10 §4.2)", () => {
  const cases: Array<[string, string]> = [
    ["What breaks if the checkout-processor Lambda is deleted?", "blast_radius"],
    ["What depends on the prod-orders RDS?", "dependents"],
    ["Which repo deploys to orders-api?", "deploy_mapping"],
    ["Explain our architecture", "architecture"],
    ["What changed this week?", "timeline"],
    ["Which PR caused the outage?", "culprit"],
    ["Who owns checkout?", "lookup"],
    ["What is the capital of France?", "out_of_scope"],
    // Aggregate / estate questions (P0 slice) — these used to fall to `lookup` and fail.
    ["Who are the top contributors on Bitbucket?", "estate"],
    ["Who are the top contributors this month?", "estate"],
    ["How many repositories are there?", "estate"],
    ["What do I have connected?", "estate"],
    ["Which repositories have no CI/CD pipeline?", "estate"],
    ["What needs attention?", "estate"],
    ["Which are my most active repositories?", "estate"],
    // Advisory / optimisation (P2) — "how to fix/improve", not just "what is".
    ["How do I improve my CI/CD setup?", "advisory"],
    ["How can I make my infrastructure more secure?", "advisory"],
    ["What should I fix first?", "advisory"],
    ["Give me recommendations for my estate", "advisory"],
    ["Review my security posture", "advisory"],
  ];
  it.each(cases)("%s → %s", (q, intent) => {
    expect(classifyIntent(q)).toBe(intent);
  });

  it("keeps entity dependency questions on the traversal path (not estate)", () => {
    // "how many services depend on X" must still resolve the entity, not the estate snapshot.
    expect(classifyIntent("What depends on the payments service?")).toBe("dependents");
  });
});

describe("extractTerms", () => {
  it("prefers identifier-like tokens, drops stopwords/intent words", () => {
    expect(extractTerms("What breaks if the checkout-processor Lambda is deleted?")).toEqual([
      "checkout-processor",
    ]);
    expect(extractTerms("What depends on the prod-orders RDS?")).toEqual(["prod-orders"]);
    expect(extractTerms("Who owns checkout?")).toEqual(["checkout"]); // no identifier → content word
  });
});

describe("resolveEntity", () => {
  const port = fakePort([
    { id: "n1", kind: "aws.lambda.function", name: "checkout-processor" },
    { id: "n2", kind: "aws.rds.instance", name: "prod-orders" },
  ]);

  it("resolves a single entity", async () => {
    const e = await resolveEntity(port, "o", "what breaks if checkout-processor is deleted");
    expect(e?.candidates.map((c) => c.id)).toEqual(["n1"]);
  });

  it("returns [] candidates when nothing matches (→ honest-absence downstream)", async () => {
    const e = await resolveEntity(port, "o", "what about the ghost-service");
    expect(e?.candidates).toEqual([]);
  });

  it("keeps multiple near-top candidates (ambiguity, P3)", async () => {
    const ambiguous = fakePort([
      { id: "a", kind: "aws.ecs.service", name: "orders" },
      { id: "b", kind: "aws.rds.instance", name: "orders" },
    ]);
    const e = await resolveEntity(ambiguous, "o", "tell me about orders");
    expect(e?.candidates.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });
});

describe("plan", () => {
  const port = fakePort([{ id: "n2", kind: "aws.rds.instance", name: "prod-orders" }]);

  it("blast-radius plan resolves the entity", async () => {
    const p = await plan(port, "o", "what breaks if prod-orders is deleted");
    expect(p.intent).toBe("blast_radius");
    expect(p.entity?.candidates[0]?.id).toBe("n2");
  });

  it("timeline plan carries a window and no entity lookup", async () => {
    const p = await plan(port, "o", "what changed this week");
    expect(p.intent).toBe("timeline");
    expect(p.window).toEqual({ sinceDays: 7 });
    expect(p.entity).toBeUndefined();
  });

  it("out-of-scope short-circuits (no retrieval)", async () => {
    const p = await plan(port, "o", "what is the capital of France");
    expect(p.intent).toBe("out_of_scope");
    expect(p.entity).toBeUndefined();
  });
});
