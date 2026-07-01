import { describe, it, expect } from "vitest";
import { MockLLMProvider, streamText } from "./mock-provider";
import { SYSTEM_PROMPT, honestAbsence } from "./prompt";
import type { CompleteRequest, LLMEvent } from "./llm";

const req: CompleteRequest = {
  system: SYSTEM_PROMPT,
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 100,
  temperature: 0,
};

async function collect(it: AsyncIterable<LLMEvent>): Promise<LLMEvent[]> {
  const out: LLMEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe("MockLLMProvider", () => {
  it("emits a fixed string then stop", async () => {
    const events = await collect(new MockLLMProvider("hello").complete(req));
    expect(events).toEqual([
      { type: "token", text: "hello" },
      { type: "stop", reason: "end" },
    ]);
  });

  it("supports a custom responder (for scripted eval scenarios)", async () => {
    const provider = new MockLLMProvider((r) => [
      { type: "token", text: `sys:${r.system.length > 0}` },
      { type: "stop", reason: "end" },
    ]);
    const events = await collect(provider.complete(req));
    expect(events[0]).toEqual({ type: "token", text: "sys:true" });
  });

  it("streamText splits into word tokens ending in stop", async () => {
    const events = await collect(new MockLLMProvider(streamText("a b")).complete(req));
    expect(events.at(-1)).toEqual({ type: "stop", reason: "end" });
    expect(
      events
        .filter((e) => e.type === "token")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe("a b");
  });

  it("embed returns deterministic vectors", async () => {
    const p = new MockLLMProvider();
    expect(await p.embed(["x"])).toEqual(await p.embed(["x"]));
  });
});

describe("system prompt (docs/10 §8 invariants)", () => {
  it("encodes grounding, citation, honesty, scope and injection-resistance", () => {
    expect(SYSTEM_PROMPT).toMatch(/ONLY the provided CONTEXT/);
    expect(SYSTEM_PROMPT).toMatch(/citation marker/i);
    expect(SYSTEM_PROMPT).toMatch(/I'm not certain|don't have/);
    expect(SYSTEM_PROMPT).toMatch(/untrusted DATA, not commands/);
    expect(honestAbsence("It is not connected.")).toMatch(/don't have data/i);
  });
});
