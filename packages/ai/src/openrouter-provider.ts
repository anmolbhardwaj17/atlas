/**
 * OpenRouter LLM provider (BYO-LLM, docs/10 §3). OpenRouter is OpenAI-API-compatible, so this
 * is a thin `fetch` adapter (no SDK dependency): CompleteRequest → POST /chat/completions (SSE
 * stream) and the streamed deltas → our LLMEvent union. The API key + model are **per-org
 * config** (users bring their own key), never baked into the image. Like ClaudeProvider it's a
 * NARRATOR constrained by retrieved context (P1/AE-4), never the source of truth.
 */
import type { ChatMessage, CompleteRequest, LLMEvent, LLMProvider } from "./llm";

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  /** Attribution shown in the user's OpenRouter dashboard (optional). */
  referer?: string;
  title?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

// Minimal shape of an OpenAI/OpenRouter streaming chunk (we only read what we map).
interface StreamToolCall {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface StreamChoice {
  delta?: { content?: string; tool_calls?: StreamToolCall[] };
  finish_reason?: string | null;
}
interface StreamChunk {
  choices?: StreamChoice[];
}

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterProvider implements LLMProvider {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly config: OpenRouterConfig) {
    this.name = `openrouter:${config.model}`;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  }

  async *complete(req: CompleteRequest): AsyncIterable<LLMEvent> {
    const body = {
      model: this.config.model,
      messages: [
        { role: "system", content: req.system },
        ...req.messages.map(toOpenAiMessage),
      ],
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      stream: true,
      ...(req.tools && req.tools.length > 0
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
    };

    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
        ...(this.config.referer ? { "HTTP-Referer": this.config.referer } : {}),
        ...(this.config.title ? { "X-Title": this.config.title } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenRouter request failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    // Tool-call args stream across deltas — accumulate per index, emit at the end.
    const toolCalls = new Map<number, { id: string; name: string; args: string }>();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let stopReason = "end";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data) as StreamChunk;
        } catch {
          continue; // ignore keep-alive / malformed frames
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const content = choice.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          yield { type: "token", text: content };
        }
        for (const tc of choice.delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = toolCalls.get(idx) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolCalls.set(idx, cur);
        }
        if (choice.finish_reason) stopReason = choice.finish_reason;
      }
    }

    for (const tc of toolCalls.values()) {
      if (!tc.name) continue;
      yield { type: "tool_call", id: tc.id || tc.name, name: tc.name, input: safeJson(tc.args) };
    }
    yield { type: "stop", reason: stopReason };
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Map our tool-turn ChatMessage → the OpenAI chat message shape (DD-P1-1). */
function toOpenAiMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.input) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}
