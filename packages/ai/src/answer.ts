/**
 * The answer pipeline (docs/10 §4.6–§4.7, §5–§7). Orchestrates plan → retrieve → gate →
 * narrate (LLM) → deterministic post-process. The generative step is bounded on both
 * sides: the grounding gate (L1) runs BEFORE it, and the citation engine (L4/DD-5) +
 * uncited-claim detector (L5) + confidence scorer (§5) run AFTER it. The model is a
 * narrator; correctness comes from retrieval, not the model (P1/AE-4).
 */
import type { LLMProvider } from "./llm";
import type { RetrievalPort } from "./retrieval-port";
import { plan } from "./planner";
import { orchestrate } from "./retrieval";
import { buildContext, type Cite } from "./context";
import { groundingGate } from "./grounding";
import { SYSTEM_PROMPT, honestAbsence } from "./prompt";

export type OverallConfidence = "observed" | "inferred-high" | "inferred-low" | "insufficient";

export interface AnswerCitation {
  /** 1-based display number (order of first appearance) rendered as [1], [2]… */
  number: number;
  marker: string; // the context marker, e.g. N1 / E2
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
  /** Factual-looking sentences with no citation (L5) — surfaced, not hidden. */
  uncitedClaims: string[];
  nodesConsidered: number;
}

export interface AnswerDeps {
  port: RetrievalPort;
  llm: LLMProvider;
  maxTokens?: number;
}

export async function answerQuestion(
  deps: AnswerDeps,
  orgId: string,
  question: string,
): Promise<Answer> {
  const p = await plan(deps.port, orgId, question);
  const retrieval = await orchestrate(deps.port, orgId, p);
  const gate = groundingGate(retrieval);

  if (!gate.grounded) {
    // Honest-absence — never invoke the model to fill a gap (L1, US-11).
    return {
      grounded: false,
      text: honestAbsence(gate.reason ?? "I don't have that data."),
      citations: [],
      confidence: "insufficient",
      caveats: [],
      uncitedClaims: [],
      nodesConsidered: 0,
    };
  }

  const built = buildContext(orgId, retrieval);
  const narration = await narrate(deps, question, built.context);
  const citations = bindCitations(narration, built.cites);
  const uncitedClaims = detectUncitedClaims(narration);
  const confidence = scoreConfidence(citations, built.cites);

  return {
    grounded: true,
    text: narration,
    citations,
    confidence,
    caveats: built.freshnessNotes,
    uncitedClaims,
    nodesConsidered: built.nodesConsidered,
  };
}

async function narrate(deps: AnswerDeps, question: string, context: string): Promise<string> {
  const parts: string[] = [];
  for await (const ev of deps.llm.complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
    maxTokens: deps.maxTokens ?? 1024,
    temperature: 0,
  })) {
    if (ev.type === "token") parts.push(ev.text);
  }
  return parts.join("").trim();
}

const MARKER_RE = /\[([NE]\d+)\]/g;

/**
 * Bind the narration's markers to real node/edge ids (DD-5) — deterministic, so the model
 * cannot fabricate a source. Unknown markers are dropped (they resolve to nothing).
 */
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

/** L5: factual-looking sentences with no citation marker. A hedge/absence sentence is fine. */
const HAS_MARKER = /\[[NE]\d+\]/; // non-global (stateless .test)
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
