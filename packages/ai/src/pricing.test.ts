import { describe, it, expect } from "vitest";
import { estimateCostUsd, rateFor } from "./pricing";

describe("model pricing", () => {
  it("prices a known model off its published rate", () => {
    // 1M in + 1M out on Opus 5 = $5 + $25.
    expect(estimateCostUsd("claude-opus-5", { inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(
      30,
      6,
    );
  });

  it("resolves dated snapshots and provider prefixes to the base model", () => {
    // Real full id of haiku-4-5; Bedrock prefixes ids with `anthropic.`; our OpenRouter provider
    // names itself `openrouter:<model>`, and that name is what reaches the meter.
    expect(rateFor("claude-haiku-4-5-20251001")).toEqual(rateFor("claude-haiku-4-5"));
    expect(rateFor("anthropic.claude-opus-5")).toEqual(rateFor("claude-opus-5"));
    expect(rateFor("openrouter:claude-sonnet-5")).toEqual(rateFor("claude-sonnet-5"));
  });

  // Models we don't have published rates for are deliberately NOT guessed at — they take the
  // conservative fallback instead. Asserted so nobody "helpfully" adds an invented rate later.
  it("does not invent rates for models absent from the table", () => {
    expect(rateFor("claude-opus-4-1")).toEqual(rateFor("a-model-that-does-not-exist"));
  });

  // The longest-prefix rule matters because several ids are substrings of longer ones; a naive
  // first-match would price opus-5 traffic at a different tier depending on object key order.
  it("prefers the longest matching model id", () => {
    expect(rateFor("claude-opus-4-8").inputPerMTok).toBe(5);
    expect(rateFor("claude-sonnet-5").outputPerMTok).toBe(15);
  });

  // An unknown model must never be cheap: the cap is a spend guard, and under-pricing an
  // unrecognised model is how a guard silently stops guarding.
  it("charges an unknown model at the most expensive known rate", () => {
    const unknown = rateFor("some-model-we-have-never-seen");
    const dearest = Math.max(
      ...["claude-fable-5", "claude-opus-5", "claude-haiku-4-5"].map(
        (m) => rateFor(m).outputPerMTok,
      ),
    );
    expect(unknown.outputPerMTok).toBeGreaterThanOrEqual(dearest);
  });

  it("prices cache reads at a tenth of input and cache writes at 1.25x", () => {
    const base = estimateCostUsd("claude-opus-5", { inputTokens: 1e6, outputTokens: 0 });
    const reads = estimateCostUsd("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1e6,
    });
    const writes = estimateCostUsd("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1e6,
    });
    expect(reads).toBeCloseTo(base * 0.1, 6);
    expect(writes).toBeCloseTo(base * 1.25, 6);
  });

  it("treats absent usage as zero cost, never NaN", () => {
    expect(estimateCostUsd("claude-opus-5", { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
