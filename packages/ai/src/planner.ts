/**
 * Query planner (docs/10 §4.2, DD-2). Maps a question → a typed retrieval plan biased
 * toward deterministic graph traversals — keeping the expensive/critical retrieval bounded
 * and the canonical questions reliable (they map to fixed plans). Intent classification is
 * rule-based (deterministic, testable); entity mentions are resolved to node ids via the
 * RetrievalPort's search. Ambiguous mentions yield multiple candidates (never silently pick
 * one — P3); the answer pipeline disambiguates or narrates over candidates with citations.
 */
import type { RetrievalPort, SearchHit } from "./retrieval-port";

export type Intent =
  | "blast_radius"
  | "dependents"
  | "deploy_mapping"
  | "architecture"
  | "timeline"
  | "culprit"
  | "lookup"
  | "out_of_scope";

export interface ResolvedEntity {
  /** The search terms used (for the honest-absence reason / "show retrieval"). */
  mention: string;
  /** Best-first candidates; length 0 = unresolved, >1 = ambiguous. */
  candidates: SearchHit[];
}

export interface RetrievalPlan {
  intent: Intent;
  question: string;
  entity?: ResolvedEntity;
  /** For timeline/culprit intents. */
  window?: { sinceDays: number };
}

const OUT_OF_SCOPE =
  /\b(capital of|the weather|meaning of life|who is the|tell me a joke|write me|president|stock price)\b/i;

/** Ordered rules — first match wins (docs/10 §4.2 intent table). */
const INTENT_RULES: Array<{ intent: Intent; re: RegExp }> = [
  {
    intent: "blast_radius",
    re: /\b(break|breaks|impact|affected|blast).*\b(if|when|delet|remov|goes? down|fails?)\b/i,
  },
  { intent: "blast_radius", re: /what happens if .* (is|are) (delet|remov|down)/i },
  {
    intent: "culprit",
    re: /\b(which|what) (pr|pull request|change|commit).*(caus|broke|culprit|responsible)/i,
  },
  { intent: "culprit", re: /\b(culprit|who broke|what broke)\b/i },
  { intent: "deploy_mapping", re: /\b(which|what) repo.*deploy|deploys? to|deployed to\b/i },
  {
    intent: "dependents",
    re: /\b(what|which).*(depend on|depends on|uses|connect(s)? to|dependents)\b/i,
  },
  {
    intent: "timeline",
    re: /\bwhat.*(chang|happened|new|deployed).*(this week|today|recently|since|lately)\b/i,
  },
  { intent: "timeline", re: /\bwhat changed\b/i },
  {
    intent: "architecture",
    re: /\b(explain|describe|overview of).*(architecture|system|setup)\b/i,
  },
  { intent: "architecture", re: /\barchitecture\b/i },
  {
    intent: "lookup",
    re: /\b(who owns|how does .* work|what is|where is|show me|find|tell me about)\b/i,
  },
];

export function classifyIntent(question: string): Intent {
  if (OUT_OF_SCOPE.test(question)) return "out_of_scope";
  for (const rule of INTENT_RULES) if (rule.re.test(question)) return rule.intent;
  return "lookup"; // default: try to resolve an entity; the grounding gate handles absence
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "if",
  "when",
  "what",
  "which",
  "who",
  "how",
  "does",
  "do",
  "did",
  "to",
  "of",
  "on",
  "in",
  "for",
  "and",
  "or",
  "this",
  "that",
  "these",
  "it",
  "its",
  "our",
  "my",
  "we",
  "us",
  "would",
  "will",
  "get",
  "got",
  "deleted",
  "delete",
  "removed",
  "remove",
  "down",
  "breaks",
  "break",
  "happens",
  "happen",
  "impact",
  "affected",
  "depends",
  "depend",
  "deploy",
  "deploys",
  "deployed",
  "changed",
  "change",
  "owns",
  "own",
  "work",
  "works",
  "show",
  "me",
  "find",
  "about",
  "explain",
  "architecture",
  "week",
  "today",
  "recently",
  "since",
  "connect",
  "connects",
  "uses",
  "use",
  "caused",
  "pr",
  "culprit",
  "service",
  "database",
  "repo",
]);

/** Identifier-like: contains a separator or a digit (ARNs, `prod-orders`, `orders_api`). */
function isIdentifierLike(term: string): boolean {
  return /[-_.]/.test(term) || /\d/.test(term);
}

/** Significant terms to search on (identifiers preferred; else content words). */
export function extractTerms(question: string): string[] {
  const words = (question.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/gi) ?? []).filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
  const ids = words.filter(isIdentifierLike);
  return [...new Set(ids.length > 0 ? ids : words)].slice(0, 6);
}

/**
 * Resolve the question's entity mention(s) to node candidates via search. Merges hits
 * across terms, ranks by score, and keeps near-top hits as candidates (ambiguity → P3).
 */
export async function resolveEntity(
  port: RetrievalPort,
  orgId: string,
  question: string,
): Promise<ResolvedEntity | undefined> {
  const terms = extractTerms(question);
  if (terms.length === 0) return undefined;
  const byId = new Map<string, SearchHit>();
  for (const term of terms) {
    for (const hit of await port.search(orgId, term, 5)) {
      const prev = byId.get(hit.id);
      if (!prev || hit.score > prev.score) byId.set(hit.id, hit);
    }
  }
  const ranked = [...byId.values()].sort((a, b) => b.score - a.score);
  const mention = terms.join(" ");
  if (ranked.length === 0) return { mention, candidates: [] };
  const top = ranked[0]?.score ?? 0;
  const candidates = ranked.filter((h) => h.score >= top * 0.9).slice(0, 5);
  return { mention, candidates };
}

/** Build the full retrieval plan (intent + resolved entity + window). */
export async function plan(
  port: RetrievalPort,
  orgId: string,
  question: string,
): Promise<RetrievalPlan> {
  const intent = classifyIntent(question);
  if (intent === "out_of_scope") return { intent, question };
  if (intent === "timeline") return { intent, question, window: { sinceDays: 7 } };

  const entity = await resolveEntity(port, orgId, question);
  const base: RetrievalPlan = { intent, question };
  if (entity) base.entity = entity;
  if (intent === "culprit") base.window = { sinceDays: 7 };
  return base;
}
