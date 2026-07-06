import { describe, it, expect } from "vitest";
import { retrievalLoop, collectLoop } from "./loop";
import { MockLLMProvider } from "./mock-provider";
import type { CompleteRequest, LLMEvent } from "./llm";
import type { EstateOverview, RetrievalPort } from "./retrieval-port";

const ESTATE: EstateOverview = {
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
  topContributors: [{ name: "Mohit", count: 87 }],
  mostActiveRepos: [{ name: "api-backend", count: 49 }],
  pipelineCoverage: { withPipeline: 8, total: 12 },
  infrastructure: [],
  findings: [
    { title: "4 repos have no CI/CD", severity: "medium", category: "Code hygiene", count: 4 },
  ],
  sources: { total: 2, healthy: 2, lastSyncAt: "2026-07-04T10:00:00Z" },
};

function fakePort(overrides: Partial<RetrievalPort> = {}): RetrievalPort {
  return {
    async search() {
      return [{ id: "n1", kind: "aws.rds.instance", name: "orders-db", score: 1 }];
    },
    async getNode(_o, id) {
      return {
        id,
        urn: `aws:us-east-1:1:rds:${id}`,
        kind: "aws.rds.instance",
        name: "orders-db",
        status: "active",
        confidence: "observed",
        region: "us-east-1",
        provenance: null,
      };
    },
    async blastRadius() {
      return {
        root: { id: "n1", urn: "u", kind: "k", name: "orders-db" },
        impacted: [],
        warnings: [],
        truncated: false,
      };
    },
    async dependencies() {
      return {
        root: { id: "n1", urn: "u", kind: "k", name: "orders-db" },
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
      return ESTATE;
    },
    ...overrides,
  };
}

/** A provider that returns a scripted event batch per hop (deterministic loop testing). */
function scripted(hops: LLMEvent[][]): MockLLMProvider {
  let i = 0;
  return new MockLLMProvider((_req: CompleteRequest) => hops[Math.min(i++, hops.length - 1)] ?? []);
}
const call = (id: string, name: string, input: Record<string, unknown> = {}): LLMEvent => ({
  type: "tool_call",
  id,
  name,
  input,
});
const stop = (reason: string): LLMEvent => ({ type: "stop", reason });

describe("retrievalLoop (agentic tool loop)", () => {
  it("calls a tool, accumulates cited context, then stops", async () => {
    const llm = scripted([[call("c1", "estate_overview"), stop("tool_calls")], [stop("end_turn")]]);
    const res = await collectLoop({ port: fakePort(), llm }, "o", "how many repos");
    expect(res.grounded).toBe(true);
    expect(res.steps.map((s) => s.tool)).toEqual(["estate_overview"]);
    expect(res.built.context).toContain("ESTATE OVERVIEW");
    expect(res.built.context).toContain("Mohit=87");
    expect(res.built.cites.some((c) => c.kind === "computed" && c.marker === "A1")).toBe(true);
  });

  it("yields a live step per tool call and binds node citations across hops", async () => {
    const llm = scripted([
      [call("c1", "search", { q: "orders" }), stop("tool_calls")],
      [call("c2", "get_node", { id: "n1" }), stop("tool_calls")],
      [stop("end_turn")],
    ]);
    const gen = retrievalLoop({ port: fakePort(), llm }, "o", "tell me about orders-db");
    const steps: string[] = [];
    let next = await gen.next();
    while (!next.done) {
      steps.push(next.value.tool);
      next = await gen.next();
    }
    expect(steps).toEqual(["search", "get_node"]);
    expect(next.value.grounded).toBe(true);
    expect(next.value.built.context).toMatch(/N1 \(cite:n1\)/);
    expect(next.value.built.nodesConsidered).toBe(1);
  });

  it("de-dups an identical repeated tool call (loop guard)", async () => {
    const llm = scripted([
      [call("c1", "estate_overview"), stop("tool_calls")],
      [call("c2", "estate_overview"), stop("tool_calls")], // duplicate → skipped
      [stop("end_turn")],
    ]);
    const res = await collectLoop({ port: fakePort(), llm }, "o", "x");
    expect(res.steps.length).toBe(1);
  });

  it("is not grounded when the model calls no tools (→ honest absence upstream)", async () => {
    const llm = scripted([[stop("end_turn")]]);
    const res = await collectLoop({ port: fakePort(), llm }, "o", "x");
    expect(res.grounded).toBe(false);
    expect(res.built.context).not.toContain("NODES:");
  });

  it("recovers from a tool error without crashing the loop", async () => {
    const port = fakePort({
      async getNode() {
        throw new Error("db down");
      },
    });
    const llm = scripted([
      [call("c1", "get_node", { id: "n1" }), stop("tool_calls")],
      [stop("end")],
    ]);
    const res = await collectLoop({ port, llm }, "o", "x");
    // error surfaced to the model as a step summary; loop still returns (not grounded here).
    expect(res.steps[0]?.summary).toMatch(/error running get_node: db down/);
    expect(res.grounded).toBe(false);
  });
});
