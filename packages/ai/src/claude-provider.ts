/**
 * Claude LLM provider (docs/10 §3, A40) — the production narrator. Thin adapter over the
 * Anthropic SDK: maps our provider-agnostic CompleteRequest → a streamed messages call
 * and the SDK's stream events → our LLMEvent union. Not unit-tested (needs a live key);
 * the MockLLMProvider covers the engine logic. Model + key are per-env config.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { CompleteRequest, LLMEvent, LLMProvider } from "./llm";

export interface ClaudeConfig {
  apiKey?: string;
  model?: string;
}

export class ClaudeProvider implements LLMProvider {
  readonly name = "anthropic-claude";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: ClaudeConfig = {}) {
    this.client = new Anthropic({ apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.model = config.model ?? "claude-opus-4-8";
  }

  async *complete(req: CompleteRequest): AsyncIterable<LLMEvent> {
    const stream = this.client.messages.stream({
      model: this.model,
      system: req.system,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    });

    // Accumulate streamed tool-call JSON per content block; emit on block stop.
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();

    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        toolBlocks.set(event.index, {
          id: event.content_block.id,
          name: event.content_block.name,
          json: "",
        });
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          yield { type: "token", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          const block = toolBlocks.get(event.index);
          if (block) block.json += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        const block = toolBlocks.get(event.index);
        if (block) {
          toolBlocks.delete(event.index);
          yield { type: "tool_call", id: block.id, name: block.name, input: safeJson(block.json) };
        }
      }
    }
    yield { type: "stop", reason: "end" };
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
