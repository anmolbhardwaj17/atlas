/**
 * The answer pipeline (docs/10 §4.6–§4.7, §5–§7). Orchestrates plan → retrieve → gate →
 * narrate (LLM) → deterministic post-process. The generative step is bounded on both
 * sides: the grounding gate (L1) runs BEFORE it, and the citation engine (L4/DD-5) +
 * uncited-claim detector (L5) + confidence scorer (§5) run AFTER it. The model is a
 * narrator; correctness comes from retrieval, not the model (P1/AE-4).
 *
 * `answerQuestion` returns a full Answer; `answerQuestionStream` yields SSE-shaped events
 * (docs/08 §10.2). Both share `prepare` (plan→retrieve→gate→context) so behavior matches.
 */
import type { LLMProvider } from "./llm";
import type { RetrievalPort } from "./retrieval-port";
import { plan, type Intent } from "./planner";
import { orchestrate } from "./retrieval";
import { buildContext, type BuiltContext, type Cite } from "./context";
import { groundingGate } from "./grounding";
import { SYSTEM_PROMPT, honestAbsence } from "./prompt";

export type OverallConfidence = "observed" | "inferred-high" | "inferred-low" | "insufficient";

export interface AnswerCitation {
  number: number;
  marker: string;
  kind: "node" | "edge";
  id: string;
  confidence: string | null;
  provenanceUrl: string;
}

export interface Answer {
  grounded: boolean;
  text: string;
  citations: AnswerCitation[];
  confidence: OverallConfidence;
  caveats: string[];
  uncitedClaims: string[];
  nodesConsidered: number;
}

export interface AnswerDeps {
  port: RetrievalPort;
  llm: LLMProvider;
  maxTokens?: number;
}

type Prepared =
  | { grounded: false; intent: Intent; reason: string }
  | { grounded: true; intent: Intent; built: BuiltContext };

async function prepare(deps: AnswerDeps, orgId: string, question: string): Promise<Prepared> {
  const p = await plan(deps.port, orgId, question);
  const retrieval = await orchestrate(deps.port, orgId, p);
  const gate = groundingGate(retrieval);
  if (!gate.grounded) {
    return { grounded: false, intent: p.intent, reason: gate.reason ?? "I don't have that data." };
  }
  return { grounded: true, intent: p.intent, built: buildContext(orgId, retrieval) };
}

function userMessage(context: string, question: string): string {
  return `${context}\n\nQuestion: ${question}`;
}

export async function answerQuestion(
  deps: AnswerDeps,
  orgId: string,
  question: string,
): Promise<Answer> {
  const prep = await prepare(deps, orgId, question);
  if (!prep.grounded) {
    return {
      grounded: false,
      text: honestAbsence(prep.reason),
      citations: [],
      confidence: "insufficient",
      caveats: [],
      uncitedClaims: [],
      nodesConsidered: 0,
    };
  }
  const narration = await narrate(deps, prep.built.context, question);
  const citations = bindCitations(narration, prep.built.cites);
  return {
    grounded: true,
    text: narration,
    citations,
    confidence: scoreConfidence(citations, prep.built.cites),
    caveats: prep.built.freshnessNotes,
    uncitedClaims: detectUncitedClaims(narration),
    nodesConsidered: prep.built.nodesConsidered,
  };
}

export type AnswerEvent =
  | { type: "retrieval"; nodesConsidered: number; intent: Intent }
  | { type: "token"; text: string }
  | { type: "citation"; citation: AnswerCitation }
  | { type: "confidence"; overall: OverallConfidence; caveats: string[] }
  | { type: "done"; grounded: boolean; citations: number };

/** Streamed answer (docs/08 §10.2 SSE): retrieval → token* → citation* → confidence → done. */
export async function* answerQuestionStream(
  deps: AnswerDeps,
  orgId: string,
  question: string,
): AsyncIterable<AnswerEvent> {
  const prep = await prepare(deps, orgId, question);

  if (!prep.grounded) {
    yield { type: "retrieval", nodesConsidered: 0, intent: prep.intent };
    yield { type: "token", text: honestAbsence(prep.reason) };
    yield { type: "confidence", overall: "insufficient", caveats: [] };
    yield { type: "done", grounded: false, citations: 0 };
    return;
  }

  yield { type: "retrieval", nodesConsidered: prep.built.nodesConsidered, intent: prep.intent };
  const parts: string[] = [];
  for await (const ev of deps.llm.complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage(prep.built.context, question) }],
    maxTokens: deps.maxTokens ?? 1024,
    temperature: 0,
  })) {
    if (ev.type === "token") {
      parts.push(ev.text);
      yield { type: "token", text: ev.text };
    }
  }
  const narration = parts.join("").trim();
  const citations = bindCitations(narration, prep.built.cites);
  for (const citation of citations) yield { type: "citation", citation };
  yield {
    type: "confidence",
    overall: scoreConfidence(citations, prep.built.cites),
    caveats: prep.built.freshnessNotes,
  };
  yield { type: "done", grounded: true, citations: citations.length };
}

async function narrate(deps: AnswerDeps, context: string, question: string): Promise<string> {
  const parts: string[] = [];
  for await (const ev of deps.llm.complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage(context, question) }],
    maxTokens: deps.maxTokens ?? 1024,
    temperature: 0,
  })) {
    if (ev.type === "token") parts.push(ev.text);
  }
  return parts.join("").trim();
}

const MARKER_RE = /\[([NE]\d+)\]/g;

/** Bind markers → real ids (DD-5), deterministic; unknown markers are dropped. */
export function bindCitations(narration: string, cites: Cite[]): AnswerCitation[] {
  const byMarker = new Map(cites.map((c) => [c.marker, c]));
  const out: AnswerCitation[] = [];
  const seen = new Set<string>();
  for (const m of narration.matchAll(MARKER_RE)) {
    const marker = m[1] as string;
    if (seen.has(marker)) continue;
    const cite = byMarker.get(marker);
    if (!cite) continue;
    seen.add(marker);
    out.push({
      number: out.length + 1,
      marker: cite.marker,
      kind: cite.kind,
      id: cite.id,
      confidence: cite.confidence,
      provenanceUrl: `/api/v1/${cite.kind === "edge" ? "edges" : "nodes"}/${cite.id}`,
    });
  }
  return out;
}

const HAS_MARKER = /\[[NE]\d+\]/;
/** L5: factual-looking sentences with no citation marker. A hedge/absence sentence is fine. */
export function detectUncitedClaims(narration: string): string[] {
  const HEDGE = /\b(I don't|I'm not|not certain|no data|couldn't find|cannot|outside)\b/i;
  return narration
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 6 && !HAS_MARKER.test(s) && !HEDGE.test(s));
}

/** Overall = the weakest confidence among cited facts (docs/10 §5, weakest-link, P3). */
export function scoreConfidence(citations: AnswerCitation[], allCites: Cite[]): OverallConfidence {
  const rank: Record<string, number> = { observed: 3, "inferred-high": 2, "inferred-low": 1 };
  const pool = citations.length > 0 ? citations : allCites;
  const ranks = pool
    .map((c) => (c.confidence ? rank[c.confidence] : undefined))
    .filter((r): r is number => r !== undefined);
  if (ranks.length === 0) return "observed";
  const min = Math.min(...ranks);
  return min >= 3 ? "observed" : min === 2 ? "inferred-high" : "inferred-low";
}
