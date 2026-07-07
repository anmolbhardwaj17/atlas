/**
 * Deterministic mock LLM provider (docs/10 §3, docs/14). Drives the AI eval set and unit
 * tests without a live model: a responder maps a request → a fixed event stream, so we
 * can assert the engine's deterministic scaffolding (planning, grounding, citations,
 * honest-absence) independent of any model's stochasticity.
 */
import type { CompleteRequest, LLMEvent, LLMProvider } from "./llm";

export type MockResponder = (req: CompleteRequest) => LLMEvent[];

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock";
  private readonly responder: MockResponder;

  /** Default responder: stream the provided text as one token, then stop. */
  constructor(responder: MockResponder | string = "") {
    this.responder =
      typeof responder === "string"
        ? () => [
            { type: "token", text: responder },
            { type: "stop", reason: "end" },
          ]
        : responder;
  }

  async *complete(req: CompleteRequest): AsyncIterable<LLMEvent> {
    for (const event of this.responder(req)) yield event;
  }

  /** Deterministic pseudo-embeddings (unit length, hashed) - for search tests only. */
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      let h = 0;
      for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) % 1000;
      return [h / 1000, 1 - h / 1000];
    });
  }
}

/** Build a responder that emits `text` split into word tokens (streaming shape). */
export function streamText(text: string): MockResponder {
  return () => [
    ...text.split(/(\s+)/).map((w): LLMEvent => ({ type: "token", text: w })),
    { type: "stop", reason: "end" },
  ];
}
