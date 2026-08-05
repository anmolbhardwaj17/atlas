import { describe, it, expect, vi } from "vitest";
import type { CompleteRequest, LLMEvent, LLMProvider } from "@atlas/ai";
import { MeteredLLMProvider } from "./metered-provider";
import type { AiUsageService } from "./ai-usage.service";

/** A provider that emits a couple of tokens then a `stop` carrying the given usage. */
function fakeProvider(
  usage?: LLMEvent extends never ? never : Record<string, number>,
): LLMProvider {
  return {
    name: "anthropic-claude",
    model: "claude-opus-4-8",
    async *complete(_req: CompleteRequest): AsyncIterable<LLMEvent> {
      yield { type: "token", text: "hello" };
      yield {
        type: "stop",
        reason: "end",
        ...(usage
          ? {
              usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
            }
          : {}),
      };
    },
  };
}

function fakeUsageService() {
  return {
    enforceBudget: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as AiUsageService & {
    enforceBudget: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;
  };
}

const drain = async (p: LLMProvider): Promise<LLMEvent[]> => {
  const out: LLMEvent[] = [];
  for await (const e of p.complete({ system: "", messages: [], maxTokens: 10, temperature: 0 })) {
    out.push(e);
  }
  return out;
};

describe("MeteredLLMProvider", () => {
  it("passes the wrapped provider's events through untouched", async () => {
    const usage = fakeUsageService();
    const events = await drain(
      new MeteredLLMProvider(
        fakeProvider({ inputTokens: 10, outputTokens: 5 }),
        usage,
        "org-1",
        true,
      ),
    );
    expect(events.map((e) => e.type)).toEqual(["token", "stop"]);
  });

  // The engine keys real behaviour off `llm.name === "mock"` — autoDiagnose bails to a plain alert,
  // suggestEdges refuses with an actionable message. A wrapper that renamed the provider would
  // silently disable both.
  it("preserves name and model so the engine's mock guards still fire", () => {
    const usage = fakeUsageService();
    const inner: LLMProvider = { name: "mock", complete: fakeProvider().complete };
    const wrapped = new MeteredLLMProvider(inner, usage, "org-1", true);
    expect(wrapped.name).toBe("mock");
    expect(new MeteredLLMProvider(fakeProvider(), usage, "org-1", true).model).toBe(
      "claude-opus-4-8",
    );
  });

  it("checks the budget BEFORE spending, and records usage after", async () => {
    const usage = fakeUsageService();
    await drain(
      new MeteredLLMProvider(
        fakeProvider({ inputTokens: 10, outputTokens: 5 }),
        usage,
        "org-1",
        true,
      ),
    );

    expect(usage.enforceBudget).toHaveBeenCalledWith("org-1", true);
    expect(usage.record).toHaveBeenCalledWith("org-1", "claude-opus-4-8", true, {
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  // Refusing after the tokens are spent would be theatre — the point of the cap is to not spend.
  it("does not call the model at all when the budget check throws", async () => {
    const usage = fakeUsageService();
    usage.enforceBudget.mockRejectedValue(new Error("over budget"));
    const inner = fakeProvider({ inputTokens: 10, outputTokens: 5 });
    const spy = vi.spyOn(inner, "complete");

    await expect(drain(new MeteredLLMProvider(inner, usage, "org-1", true))).rejects.toThrow(
      /over budget/,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });

  // A provider that can't report usage (the dev mock, or an endpoint that ignored
  // stream_options) must still be counted as a call — dropping it would understate spend.
  it("records the call even when the provider reports no usage", async () => {
    const usage = fakeUsageService();
    await drain(new MeteredLLMProvider(fakeProvider(), usage, "org-1", false));
    expect(usage.record).toHaveBeenCalledWith("org-1", "claude-opus-4-8", false, undefined);
  });

  it("marks BYO-key traffic as unshared so the cap does not apply to it", async () => {
    const usage = fakeUsageService();
    await drain(new MeteredLLMProvider(fakeProvider(), usage, "org-2", false));
    expect(usage.enforceBudget).toHaveBeenCalledWith("org-2", false);
  });
});
