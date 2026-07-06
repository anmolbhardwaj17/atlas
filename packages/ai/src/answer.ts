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
import { plan, classifyIntent, smalltalkReply, type Intent } from "./planner";
import { orchestrate } from "./retrieval";
import { buildContext, buildAdvisoryContext, type BuiltContext, type Cite } from "./context";
import { groundingGate } from "./grounding";
import { SYSTEM_PROMPT, ADVISORY_SYSTEM, honestAbsence } from "./prompt";
import { retrievalLoop, collectLoop } from "./loop";

/**
 * Router (DD-P1-2): open-ended intents go through the agentic tool-loop when the provider can
 * plan with tools; canonical intents keep their fast deterministic path (unchanged). The mock
 * provider (dev/CI) always uses the fast path — the loop needs a real tool-calling model.
 */
// culprit joins the loop (Phase D): diagnose + get_pr_diff do the multi-hop tracing.
const AGENTIC_INTENTS = new Set<Intent>(["lookup", "architecture", "culprit"]);
const NO_MATCH =
  "I searched your graph but couldn't find anything matching that — it may not be connected, or it's named differently.";
function agenticRoute(question: string, llm: LLMProvider): Intent | null {
  const intent = classifyIntent(question);
  return AGENTIC_INTENTS.has(intent) && llm.name !== "mock" ? intent : null;
}

export type OverallConfidence =
  "observed" | "inferred-high" | "inferred-low" | "insufficient" | "advisory";

export interface AnswerCitation {
  number: number;
  marker: string;
  kind: "node" | "edge" | "computed";
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
  | {
      grounded: true;
      intent: Intent;
      built: BuiltContext;
      /** Narrator system prompt — the closed-context narrator, or the advisory narrator (P2). */
      system: string;
      /** Advisory answers are recommendations → the `advisory` confidence tier, not a fact tier. */
      advisory: boolean;
    };

/** Recent conversation, oldest→newest, for cross-turn memory (docs/10 §9). */
export type History = Array<{ role: "user" | "assistant"; content: string }>;

/** Resolve a follow-up against history: a short/deictic message ("explain that again",
 *  "why?", "the other one") carries no topic on its own, so we prepend the last user turn
 *  for PLANNING/RETRIEVAL only - so "explain again simpler" re-fetches the topic just
 *  discussed instead of misrouting to a generic overview. The narrator gets full history
 *  separately, so it still answers conversationally. */
function planningQuestion(question: string, history: History): string {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (!lastUser) return question;
  const followupish =
    question.trim().length < 60 ||
    /\b(again|simpler|that|this|it|those|them|more|why|elaborate|expand)\b/i.test(question);
  return followupish ? `${lastUser.content}\n\n${question}` : question;
}

/** History as prior LLM turns (content only; capped + truncated to keep tokens sane). */
function historyMessages(history: History): Array<{ role: "user" | "assistant"; content: string }> {
  return history.slice(-6).map((m) => ({
    role: m.role,
    content: m.content.length > 1200 ? `${m.content.slice(0, 1200)}…` : m.content,
  }));
}

async function prepare(
  deps: AnswerDeps,
  orgId: string,
  question: string,
  signal?: AbortSignal,
): Promise<Prepared> {
  // Agentic path (non-streaming): gather via the tool-loop, ignoring the live step trace.
  const agenticIntent = agenticRoute(question, deps.llm);
  if (agenticIntent) {
    const loop = await collectLoop({ port: deps.port, llm: deps.llm }, orgId, question, signal);
    return loop.grounded
      ? {
          grounded: true,
          intent: agenticIntent,
          built: loop.built,
          system: SYSTEM_PROMPT,
          advisory: false,
        }
      : { grounded: false, intent: agenticIntent, reason: NO_MATCH };
  }
  const p = await plan(deps.port, orgId, question);
  // Advisory (P2): grounded findings + knowledge-pack guidance → labelled recommendations.
  if (p.intent === "advisory") {
    const estate = await deps.port.estateOverview(orgId);
    return {
      grounded: true,
      intent: "advisory",
      built: buildAdvisoryContext(orgId, estate),
      system: ADVISORY_SYSTEM,
      advisory: true,
    };
  }
  // Fast path (deterministic, unchanged).
  const retrieval = await orchestrate(deps.port, orgId, p);
  const gate = groundingGate(retrieval);
  if (!gate.grounded) {
    return { grounded: false, intent: p.intent, reason: gate.reason ?? "I don't have that data." };
  }
  return {
    grounded: true,
    intent: p.intent,
    built: buildContext(orgId, retrieval),
    system: SYSTEM_PROMPT,
    advisory: false,
  };
}

function userMessage(context: string, question: string): string {
  return `${context}\n\nQuestion: ${question}`;
}

export async function answerQuestion(
  deps: AnswerDeps,
  orgId: string,
  question: string,
  signal?: AbortSignal,
  history: History = [],
): Promise<Answer> {
  if (classifyIntent(question) === "smalltalk") {
    return {
      grounded: true,
      text: smalltalkReply(question),
      citations: [],
      confidence: "observed",
      caveats: [],
      uncitedClaims: [],
      nodesConsidered: 0,
    };
  }
  const prep = await prepare(deps, orgId, planningQuestion(question, history), signal);
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
  const narration = await narrate(deps, prep.built.context, question, prep.system, signal, history);
  const citations = bindCitations(narration, prep.built.cites);
  return {
    grounded: true,
    text: narration,
    citations,
    confidence: prep.advisory ? "advisory" : scoreConfidence(citations, prep.built.cites),
    caveats: prep.built.freshnessNotes,
    uncitedClaims: detectUncitedClaims(narration),
    nodesConsidered: prep.built.nodesConsidered,
  };
}

export type AnswerEvent =
  | { type: "retrieval_step"; hop: number; tool: string; summary: string }
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
  signal?: AbortSignal,
  history: History = [],
): AsyncIterable<AnswerEvent> {
  // Pleasantries ("hi", "thanks") get a warm reply, not a graph search / honest-absence.
  if (classifyIntent(question) === "smalltalk") {
    yield { type: "retrieval", nodesConsidered: 0, intent: "smalltalk" };
    yield { type: "token", text: smalltalkReply(question) };
    yield { type: "done", grounded: true, citations: 0 };
    return;
  }
  // Route: agentic path streams its retrieval steps live (show-your-work); fast path is
  // deterministic. Retrieval planning uses the history-resolved question so a follow-up
  // targets the topic under discussion, not a generic overview.
  const forPlanning = planningQuestion(question, history);
  let prep: Prepared;
  const agenticIntent = agenticRoute(forPlanning, deps.llm);
  if (agenticIntent) {
    const gen = retrievalLoop({ port: deps.port, llm: deps.llm }, orgId, forPlanning, signal);
    let next = await gen.next();
    while (!next.done) {
      const s = next.value;
      yield { type: "retrieval_step", hop: s.hop, tool: s.tool, summary: s.summary };
      next = await gen.next();
    }
    const loop = next.value;
    prep = loop.grounded
      ? {
          grounded: true,
          intent: agenticIntent,
          built: loop.built,
          system: SYSTEM_PROMPT,
          advisory: false,
        }
      : { grounded: false, intent: agenticIntent, reason: NO_MATCH };
  } else {
    prep = await prepare(deps, orgId, forPlanning, signal);
  }

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
    system: prep.system,
    // Prior turns give the narrator conversational memory; the final user message still
    // carries the fresh CONTEXT, and every fact must bind to ITS markers (grounding intact).
    messages: [
      ...historyMessages(history),
      { role: "user", content: userMessage(prep.built.context, question) },
    ],
    // Narration temperature is deliberately non-zero: the answer is a human explanation of
    // fixed CONTEXT facts, so warmth/variation here can't fabricate (grounding is enforced by
    // the closed context + citation gate, not by temperature). The PLANNER/LOOP stay at 0 -
    // tool selection must be deterministic.
    maxTokens: deps.maxTokens ?? 1500,
    temperature: 0.4,
    ...(signal ? { signal } : {}),
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
    overall: prep.advisory ? "advisory" : scoreConfidence(citations, prep.built.cites),
    caveats: prep.built.freshnessNotes,
  };
  yield { type: "done", grounded: true, citations: citations.length };
}

async function narrate(
  deps: AnswerDeps,
  context: string,
  question: string,
  system: string,
  signal?: AbortSignal,
  history: History = [],
): Promise<string> {
  const parts: string[] = [];
  for await (const ev of deps.llm.complete({
    system,
    messages: [
      ...historyMessages(history),
      { role: "user", content: userMessage(context, question) },
    ],
    maxTokens: deps.maxTokens ?? 1500,
    temperature: 0.4,
    ...(signal ? { signal } : {}),
  })) {
    if (ev.type === "token") parts.push(ev.text);
  }
  return parts.join("").trim();
}

const MARKER_RE = /\[([NEA]\d+)\]/g;

/** Bind markers → real ids (DD-5), deterministic; unknown markers are dropped. `A` markers are
 *  computed/aggregate facts whose provenance is the estate summary, not a single node/edge. */
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
      provenanceUrl:
        cite.kind === "computed"
          ? "/api/v1/summary"
          : `/api/v1/${cite.kind === "edge" ? "edges" : "nodes"}/${cite.id}`,
    });
  }
  return out;
}

const HAS_MARKER = /\[[NEA]\d+\]/;
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
