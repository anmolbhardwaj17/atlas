/**
 * Claude LLM provider (docs/10 §3, A40) - the production narrator. Thin adapter over the
 * Anthropic SDK: maps our provider-agnostic CompleteRequest → a streamed messages call
 * and the SDK's stream events → our LLMEvent union. Not unit-tested (needs a live key);
 * the MockLLMProvider covers the engine logic. Model + key are per-env config.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, CompleteRequest, LLMEvent, LLMProvider, LLMUsage } from "./llm";

export interface ClaudeConfig {
  apiKey?: string;
  model?: string;
}

/** The usage block as the API actually sends it (see the cast at `message_start`). */
interface CacheAwareUsage {
  input_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export class ClaudeProvider implements LLMProvider {
  readonly name = "anthropic-claude";
  /** Exposed (not private) so the spend meter can price calls by model — `name` can't. */
  readonly model: string;
  private readonly client: Anthropic;

  constructor(config: ClaudeConfig = {}) {
    // Explicit request deadline (the SDK also retries): a dead socket can't hang an SSE request
    // indefinitely. Generous — a long answer streams within it.
    this.client = new Anthropic({
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      timeout: 300_000,
    });
    this.model = config.model ?? "claude-opus-4-8";
  }

  async *complete(req: CompleteRequest): AsyncIterable<LLMEvent> {
    // Adaptive thinking (opus-4.6+ family): the model reasons before answering. Only requested on
    // single-turn calls (the narration) — thinking blocks stream as `thinking_delta`, which we drop
    // from the token stream below, so the answer text is unaffected. `temperature` must be omitted when
    // thinking is on (the API rejects a non-default temperature with thinking).
    const thinking = req.thinking ? ({ type: "adaptive" } as const) : undefined;
    const stream = this.client.messages.stream(
      {
        model: this.model,
        system: req.system,
        max_tokens: req.maxTokens,
        ...(thinking ? { thinking } : { temperature: req.temperature }),
        messages: req.messages.map(toClaudeMessage),
        ...(req.tools && req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      },
      req.signal ? { signal: req.signal } : undefined,
    );

    // Accumulate streamed tool-call JSON per content block; emit on block stop.
    const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
    let stopReason = "end";
    // Token accounting for the spend meter. Anthropic reports input (+ cache) once on `message_start`
    // and the running output count on each `message_delta`; the last delta carries the final total.
    let usage: LLMUsage | undefined;

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
      } else if (event.type === "message_start") {
        // The cache counters are read structurally rather than off the SDK's `Usage` type: the pinned
        // SDK (0.32.1) predates them, but the API sends them, so this picks them up now and keeps
        // compiling after an SDK bump. Absent ⇒ undefined ⇒ the meter prices the call as uncached.
        const u = event.message.usage as CacheAwareUsage;
        usage = {
          inputTokens: u.input_tokens,
          outputTokens: 0,
          // Spread rather than assign undefined: exactOptionalPropertyTypes distinguishes "absent"
          // from "present and undefined", and the meter's contract is that absent means unknown.
          ...(u.cache_read_input_tokens != null
            ? { cacheReadTokens: u.cache_read_input_tokens }
            : {}),
          ...(u.cache_creation_input_tokens != null
            ? { cacheWriteTokens: u.cache_creation_input_tokens }
            : {}),
        };
      } else if (event.type === "message_delta") {
        if (usage) usage.outputTokens = event.usage.output_tokens;
        // "tool_use" tells the loop the model wants to call tools; "end_turn" = it's done.
        if (event.delta.stop_reason) stopReason = event.delta.stop_reason;
      }
    }
    yield { type: "stop", reason: stopReason, ...(usage ? { usage } : {}) };
  }
}

/** Map our tool-turn ChatMessage → an Anthropic MessageParam (DD-P1-1). Anthropic carries a
 *  tool result as a `tool_result` block inside a USER message. */
function toClaudeMessage(m: ChatMessage): Anthropic.MessageParam {
  if (m.role === "tool") {
    return {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
    };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    const blocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
    if (m.content) blocks.push({ type: "text", text: m.content });
    for (const tc of m.toolCalls) {
      blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
    return { role: "assistant", content: blocks };
  }
  return { role: m.role, content: m.content };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
