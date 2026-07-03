import { describe, it, expect } from "vitest";
import { OpenRouterProvider } from "./openrouter-provider";
import type { LLMEvent } from "./llm";

/** A fake fetch that streams the given SSE lines as the response body. */
function fakeFetch(lines: string[], ok = true, status = 200): typeof fetch {
  return (async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const l of lines) controller.enqueue(enc.encode(l));
        controller.close();
      },
    });
    return new Response(ok ? body : "boom", { status });
  }) as unknown as typeof fetch;
}

async function collect(it: AsyncIterable<LLMEvent>): Promise<LLMEvent[]> {
  const out: LLMEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const REQ = {
  system: "s",
  messages: [{ role: "user" as const, content: "hi" }],
  maxTokens: 100,
  temperature: 0,
};

describe("OpenRouterProvider", () => {
  it("maps streamed content deltas to token events + a stop", async () => {
    const p = new OpenRouterProvider({
      apiKey: "k",
      model: "openai/gpt-4o",
      fetchImpl: fakeFetch([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: " world" }, finish_reason: null }] })}\n`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n`,
        `data: [DONE]\n`,
      ]),
    });
    const events = await collect(p.complete(REQ));
    expect(
      events
        .filter((e) => e.type === "token")
        .map((e) => (e as { text: string }).text)
        .join(""),
    ).toBe("Hello world");
    expect(events.at(-1)).toEqual({ type: "stop", reason: "stop" });
  });

  it("accumulates a streamed tool call across deltas", async () => {
    const p = new OpenRouterProvider({
      apiKey: "k",
      model: "x",
      fetchImpl: fakeFetch([
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "search", arguments: '{"q":' } }] } }] })}\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"db"}' } }] } }] })}\n`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n`,
      ]),
    });
    const events = await collect(p.complete(REQ));
    const tool = events.find((e) => e.type === "tool_call");
    expect(tool).toEqual({ type: "tool_call", id: "t1", name: "search", input: { q: "db" } });
  });

  it("throws a clear error on a non-200", async () => {
    const p = new OpenRouterProvider({
      apiKey: "bad",
      model: "x",
      fetchImpl: fakeFetch([], false, 401),
    });
    await expect(collect(p.complete(REQ))).rejects.toThrow(/OpenRouter request failed \(401\)/);
  });
});
