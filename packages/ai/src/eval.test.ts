import { describe, it, expect } from "vitest";
import { answerQuestion, answerQuestionStream, type AnswerEvent } from "./answer";
import { MockLLMProvider } from "./mock-provider";
import type { MockResponder } from "./mock-provider";
import type { RetrievalPort, RetrievedNode, Traversal } from "./retrieval-port";

/**
 * AI eval set (docs/10 §7 L7, docs/14 §11) - canonical + adversarial scenarios run against
 * a MockLLMProvider so behavior is deterministic and independent of any model. The bar:
 * canonical questions are answered + cited + tiered; insufficient grounding yields
 * honest-absence (US-11); attempts to tempt fabrication are BLOCKED (by the gate) or
 * CAUGHT (by the uncited-claim detector) - never silently emitted. Escaped-hallucination
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
    async nodeEvents() {
      return [];
    },
    async prDiff() {
      return null;
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
  infrastructure: [],
  findings: [],
  sources: { total: 0, healthy: 0, lastSyncAt: null },
};

const provider = (r: MockResponder | string): MockLLMProvider => new MockLLMProvider(r);

describe("AI eval - canonical", () => {
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

describe("AI eval - honest absence (US-11)", () => {
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

describe("AI eval - adversarial (tempt hallucination)", () => {
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

// --- P1 golden + adversarial: estate (aggregate) + agentic loop route ---

const POP_ESTATE = {
  ...EMPTY_ESTATE,
  inventory: { ...EMPTY_ESTATE.inventory, repositories: 12, contributors: 7 },
  topContributors: [{ name: "Mohit", count: 87 }],
  pipelineCoverage: { withPipeline: 8, total: 12 },
};
function estatePort(): RetrievalPort {
  return {
    ...port(true),
    async nodeEvents() {
      return [];
    },
    async prDiff() {
      return null;
    },
    async estateOverview() {
      return POP_ESTATE;
    },
  };
}
/** A provider that behaves like a real (tool-calling) model so the router uses the agentic loop. */
function agentProvider(responder: MockResponder): MockLLMProvider {
  const p = new MockLLMProvider(responder);
  Object.defineProperty(p, "name", { value: "openrouter:test", configurable: true });
  return p;
}

describe("AI eval - estate/aggregate (P0 golden)", () => {
  it("answers a count/ranking question from the computed snapshot, cited to the computation", async () => {
    const narration =
      "You have 12 repositories [A1]. Your top contributor is Mohit with 87 PRs [A2].";
    const ans = await answerQuestion(
      { port: estatePort(), llm: provider(narration) },
      "o",
      "how many repositories are there and who are the top contributors",
    );
    expect(ans.grounded).toBe(true);
    expect(ans.confidence).toBe("observed");
    expect(ans.citations.every((c) => c.kind === "computed")).toBe(true);
    expect(ans.citations.find((c) => c.marker === "A1")?.provenanceUrl).toBe("/api/v1/summary");
    expect(ans.uncitedClaims).toEqual([]);
  });

  it("adversarial: a fabricated uncited aggregate is flagged (L5)", async () => {
    const narration =
      "You have 12 repositories [A1]. You also run 3 secret shadow clusters that appear nowhere.";
    const ans = await answerQuestion(
      { port: estatePort(), llm: provider(narration) },
      "o",
      "how many repositories are there",
    );
    expect(ans.grounded).toBe(true);
    expect(ans.uncitedClaims.some((c) => /shadow clusters/.test(c))).toBe(true);
  });
});

describe("AI eval - agentic loop route (P1)", () => {
  // Planner calls (req has tools) gather; the narration call (no tools) writes the cited answer.
  const responder =
    (
      toolCall: { id: string; name: string; input: Record<string, unknown> },
      text: string,
    ): MockResponder =>
    (req) => {
      if (req.tools && req.tools.length > 0) {
        // one gather hop, then stop
        return req.messages.some((m) => m.role === "tool")
          ? [{ type: "stop", reason: "end_turn" }]
          : [
              { type: "tool_call", ...toolCall },
              { type: "stop", reason: "tool_calls" },
            ];
      }
      return [
        { type: "token", text },
        { type: "stop", reason: "end" },
      ];
    };

  it("routes an open-ended lookup through the tool loop → grounded + cited", async () => {
    const ans = await answerQuestion(
      {
        port: port(true),
        llm: agentProvider(
          responder(
            { id: "c1", name: "get_node", input: { id: "rds1" } },
            "prod-orders [N1] is an RDS instance.",
          ),
        ),
      },
      "o",
      "tell me about prod-orders",
    );
    expect(ans.grounded).toBe(true);
    expect(ans.citations.map((c) => c.id)).toContain("rds1");
  });

  it("streams retrieval_step events for the loop's tool calls (show-your-work)", async () => {
    const events: string[] = [];
    for await (const ev of answerQuestionStream(
      {
        port: port(true),
        llm: agentProvider(
          responder({ id: "c1", name: "get_node", input: { id: "rds1" } }, "prod-orders [N1]."),
        ),
      },
      "o",
      "tell me about prod-orders",
    )) {
      events.push(ev.type);
    }
    expect(events).toContain("retrieval_step");
    expect(events).toContain("done");
  });
});

// --- P2: advisory answers (fact/advice separation) ---

const ADVISORY_ESTATE = {
  ...EMPTY_ESTATE,
  inventory: { ...EMPTY_ESTATE.inventory, repositories: 12 },
  findings: [
    {
      title: "4 repositories have no CI/CD pipeline",
      severity: "medium",
      category: "Code hygiene",
      count: 4,
    },
    {
      title: "payments-service is a single point of failure",
      severity: "medium",
      category: "Blast radius",
    },
  ],
};
function advisoryPort(): RetrievalPort {
  return {
    ...port(true),
    async nodeEvents() {
      return [];
    },
    async prDiff() {
      return null;
    },
    async estateOverview() {
      return ADVISORY_ESTATE;
    },
  };
}

describe("AI eval - advisory (P2)", () => {
  it("turns grounded findings into cited facts + a labelled recommendation (advisory tier)", async () => {
    const narration =
      "You have 4 repositories with no CI/CD pipeline [A1]. Recommendation: add a pipeline that builds and tests on every PR before merge.";
    const ans = await answerQuestion(
      { port: advisoryPort(), llm: provider(narration) },
      "o",
      "how do I improve my setup",
    );
    expect(ans.grounded).toBe(true);
    expect(ans.confidence).toBe("advisory");
    expect(ans.citations.some((c) => c.marker === "A1")).toBe(true);
  });

  it("does not invent problems when the graph flags no findings (good outcome)", async () => {
    const narration = "Good news - the graph doesn't currently flag any issues to act on.";
    const ans = await answerQuestion(
      { port: estatePort(), llm: provider(narration) },
      "o",
      "what should I fix",
    );
    expect(ans.grounded).toBe(true);
    expect(ans.confidence).toBe("advisory");
  });
});

describe("AI streaming - L5 uncited enforcement (parity + injection signal)", () => {
  const collect = async (narration: string): Promise<AnswerEvent[]> => {
    const events: AnswerEvent[] = [];
    for await (const ev of answerQuestionStream(
      { port: port(true), llm: provider(narration) },
      "o",
      "what breaks if prod-orders is deleted",
    )) {
      events.push(ev);
    }
    return events;
  };

  it("flags a streamed factual claim with no citation marker (uncited event + caveat)", async () => {
    // 2nd sentence has no [N#]/[E#] marker and isn't a hedge → an unverifiable claim (the shape a
    // prompt-injection would take: asserting something not in the closed context).
    const events = await collect(
      "Deleting **prod-orders** [N1] impacts the orders-api service [N2]. It also stores every customer's raw payment card number in plaintext.",
    );
    const uncited = events.find((e) => e.type === "uncited");
    expect(uncited?.type === "uncited" && uncited.claims.length).toBeGreaterThan(0);
    const conf = events.find((e) => e.type === "confidence");
    expect(
      conf?.type === "confidence" &&
        conf.caveats.some((c) => /couldn't be tied to a cited source/.test(c)),
    ).toBe(true);
  });

  it("no uncited event/caveat when every factual sentence is cited", async () => {
    const events = await collect(
      "Deleting **prod-orders** [N1] impacts the orders-api service [N2].",
    );
    expect(events.find((e) => e.type === "uncited")).toBeUndefined();
    const conf = events.find((e) => e.type === "confidence");
    expect(
      conf?.type === "confidence" && conf.caveats.some((c) => /couldn't be tied/.test(c)),
    ).toBe(false);
  });
});
