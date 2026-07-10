import { describe, it, expect } from "vitest";
import { matchEdges, type EdgeMatcherInput } from "./edge-matcher";
import type { LLMProvider, LLMEvent, CompleteRequest } from "./llm";

/** A mock provider that streams a fixed reply as tokens (mirrors the eval harness). */
function mockLLM(reply: string): LLMProvider {
  return {
    name: "mock",
    async *complete(_req: CompleteRequest): AsyncIterable<LLMEvent> {
      yield { type: "token", text: reply };
      yield { type: "stop", reason: "end" };
    },
  };
}

const input: EdgeMatcherInput = {
  runtimes: [
    { urn: "aws:ec2/i-1", kind: "aws.ec2.instance", name: "payments-prod", facts: {} },
    { urn: "aws:ec2/i-2", kind: "aws.ec2.instance", name: "mystery-box", facts: {} },
  ],
  repos: [
    { urn: "bb:repo/payments", slug: "payments", language: "Go" },
    { urn: "bb:repo/orders", slug: "orders", language: "Java" },
  ],
};

describe("matchEdges", () => {
  it("parses a JSON array of proposals and validates urns against the input", async () => {
    const llm = mockLLM(
      JSON.stringify([
        {
          repoUrn: "bb:repo/payments",
          runtimeUrn: "aws:ec2/i-1",
          confidence: "high",
          reasoning: "name matches",
        },
      ]),
    );
    const out = await matchEdges(llm, input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      repoUrn: "bb:repo/payments",
      runtimeUrn: "aws:ec2/i-1",
      confidence: "high",
    });
    expect(out[0]?.reasoning).toBeTruthy();
  });

  it("drops a proposal referencing a hallucinated urn (P4 — can't become an edge)", async () => {
    const llm = mockLLM(
      JSON.stringify([
        {
          repoUrn: "bb:repo/GHOST",
          runtimeUrn: "aws:ec2/i-1",
          confidence: "high",
          reasoning: "made up",
        },
      ]),
    );
    expect(await matchEdges(llm, input)).toHaveLength(0);
  });

  it("drops a proposal with no reasoning, and defaults an invalid confidence to low", async () => {
    const llm = mockLLM(
      JSON.stringify([
        {
          repoUrn: "bb:repo/payments",
          runtimeUrn: "aws:ec2/i-1",
          confidence: "high",
          reasoning: "",
        },
        {
          repoUrn: "bb:repo/orders",
          runtimeUrn: "aws:ec2/i-2",
          confidence: "???",
          reasoning: "guess",
        },
      ]),
    );
    const out = await matchEdges(llm, input);
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe("low");
  });

  it("tolerates markdown fences around the JSON", async () => {
    const llm = mockLLM(
      '```json\n[{"repoUrn":"bb:repo/payments","runtimeUrn":"aws:ec2/i-1","confidence":"medium","reasoning":"x"}]\n```',
    );
    expect(await matchEdges(llm, input)).toHaveLength(1);
  });

  it("returns [] on an unparseable reply, and without calling the model on empty input", async () => {
    expect(await matchEdges(mockLLM("sorry, I cannot help"), input)).toHaveLength(0);
    let called = false;
    const spy: LLMProvider = {
      name: "spy",
      async *complete() {
        called = true;
        yield { type: "stop", reason: "end" };
      },
    };
    expect(await matchEdges(spy, { runtimes: [], repos: input.repos })).toHaveLength(0);
    expect(called).toBe(false);
  });
});
