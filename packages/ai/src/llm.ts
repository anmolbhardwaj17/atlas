/**
 * LLM provider abstraction (docs/10 §3, DD-1/AE-5). All model access goes through this
 * interface so the engine is model-agnostic: Claude is the default (A40), a mock drives
 * deterministic eval (docs/14), and a provider can be swapped per-env or on outage. The
 * LLM is a NARRATOR + planner constrained by retrieved context — never the source of
 * truth (P1/AE-4).
 */

/** A tool the model asked us to run (emitted as an `LLMEvent`, fed back as an assistant turn). */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * A conversation turn (docs/10 §4, agentic loop DD-P1-1). Tool-turn aware so the retrieval loop
 * can feed tool results back to the model across hops:
 *  - `user` / `assistant` (string content) — ordinary turns (single-shot narration uses only these).
 *  - `assistant` with `toolCalls` — the model requested tools (echoed back so it sees its own call).
 *  - `tool` — our result for a specific `toolCallId` (the loop appends one per executed tool).
 * Providers map this union onto their native shape (OpenAI `tool_calls`/`role:tool`, Anthropic
 * `tool_use`/`tool_result`).
 */
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** A retrieval tool the LLM may call to request MORE bounded retrieval (DD-3) — never
 *  the open world (A41). */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type LLMEvent =
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "stop"; reason: string };

export interface CompleteRequest {
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens: number;
  /** Low for grounded narration, not creativity (L3, docs/10 §4.6). */
  temperature: number;
  /** Abort the in-flight model call (user cancelled / disconnected) — providers pass it to the
   *  underlying request so work + cost stop server-side, not just client-side (WS cancel). */
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: CompleteRequest): AsyncIterable<LLMEvent>;
  /** Optional — embeddings may also come from a dedicated model (docs/11). */
  embed?(texts: string[]): Promise<number[][]>;
}
