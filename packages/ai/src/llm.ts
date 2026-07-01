/**
 * LLM provider abstraction (docs/10 §3, DD-1/AE-5). All model access goes through this
 * interface so the engine is model-agnostic: Claude is the default (A40), a mock drives
 * deterministic eval (docs/14), and a provider can be swapped per-env or on outage. The
 * LLM is a NARRATOR + planner constrained by retrieved context — never the source of
 * truth (P1/AE-4).
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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
}

export interface LLMProvider {
  readonly name: string;
  complete(req: CompleteRequest): AsyncIterable<LLMEvent>;
  /** Optional — embeddings may also come from a dedicated model (docs/11). */
  embed?(texts: string[]): Promise<number[][]>;
}
