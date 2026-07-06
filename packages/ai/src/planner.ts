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
  | "estate"
  | "advisory"
  | "lookup"
  | "smalltalk"
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

// Pleasantries / conversational filler — the whole message is a greeting/thanks/etc. (anchored so
// "thanks, who owns X" is still treated as the real question). Answered warmly, no graph search.
const SMALLTALK =
  /^\s*(hi+|hey+|hello+|hola|yo|sup|howdy|thanks?|thank you|thankyou|thx|ty|cheers|appreciate (it|you|that)|nice|cool|great|awesome|amazing|perfect|brilliant|ok(ay)?|k|got it|gotcha|understood|good (morning|afternoon|evening|night)|how are you|how'?s it going|what'?s up|whats up|good job|well done|bye|goodbye|see (ya|you)|later)\b[\s!.?]*$/i;

/** A warm, non-graph reply for pleasantries (greetings/thanks/etc.) — keeps Atlas friendly instead
 *  of answering "I don't have that data" to "thank you". */
export function smalltalkReply(question: string): string {
  const q = question.toLowerCase();
  if (/\b(thank|thanks|thx|ty|cheers|appreciate)\b/.test(q))
    return 'You\'re welcome! Happy to help. Ask me anything about your infrastructure, code, or deploys — like "who are the top contributors?" or "what should I fix first?"';
  if (/\b(bye|goodbye|see (ya|you)|later)\b/.test(q))
    return "See you! I'll be right here whenever you want to understand your estate.";
  if (/\bhow (are|'?s)|how'?s it going|what'?s up|whats up|how are you\b/.test(q))
    return "I'm here and ready to help you make sense of your infrastructure and code. What would you like to know?";
  if (
    /\b(nice|cool|great|awesome|amazing|perfect|brilliant|good job|well done|ok(ay)?|k|got it|gotcha|understood)\b/.test(
      q,
    )
  )
    return "Glad that helped! Let me know what else you'd like to explore.";
  return 'Hi! I\'m Atlas — your engineering intelligence assistant. Ask me anything about your infrastructure, code, or deploys, like "how many repositories do I have?" or "what needs attention?"';
}

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
  // Advisory / optimisation questions → grounded findings + best-practice guidance (P2). These
  // must come BEFORE the estate "needs attention" rule: "what should I FIX" is advice ("how"),
  // whereas "what needs attention" is a listing (estate). Recommendations, not a fixed traversal.
  {
    intent: "advisory",
    re: /\b(how (do|can|should) i|how to|help me)\b[^?]*\b(optimi[sz]|improv|secur|harden|reduce|lower|cut|fix|better|cheaper|faster|safer|resilien|tighten|clean up)/i,
  },
  {
    intent: "advisory",
    re: /\b(recommend|recommendation|suggest\w*|advice|advise|best[- ]practice)s?\b/i,
  },
  {
    intent: "advisory",
    re: /\bwhat should i (do|fix|improve|prioriti[sz]e?|address|change|tackle|worry about)\b/i,
  },
  {
    intent: "advisory",
    re: /\b(review|audit|assess|evaluate)\b[^?]*\b(my|our|the)\b[^?]*\b(setup|infra\w*|security|posture|estate|architecture|repos?|hygiene)\b/i,
  },
  // Aggregate / ranking / whole-estate questions → the org overview (counts, leaderboards,
  // findings, coverage). These are the dashboard-style questions the fixed entity planner can't
  // answer; they resolve to a computed snapshot, not a single node (P0 estate slice).
  { intent: "estate", re: /\b(how many|number of|count of|how much)\b/i },
  {
    intent: "estate",
    re: /\b(top|most[- ]active|busiest|leading|biggest)\b[^?]*\b(contributor|contributors|committer|committers|author|authors|developer|developers|repo|repos|repositor\w*|service|services)\b/i,
  },
  {
    intent: "estate",
    re: /\b(who|which)\b[^?]*\b(top|most|leading|busiest)\b[^?]*\b(contribut|committ|author|develop)/i,
  },
  { intent: "estate", re: /\bcontributors?\b/i },
  {
    intent: "estate",
    re: /\b(what|which)\b[^?]*\b(do i have|have i (got|connected)|is connected|are connected|am i (running|using))\b/i,
  },
  {
    intent: "estate",
    re: /\b(overview|snapshot|at a glance)\b[^?]*\b(estate|infra\w*|system|setup|environment|org|everything|graph)\b/i,
  },
  {
    intent: "estate",
    re: /\b(needs? attention|what should i (look at|fix|prioriti|worry)|any (issues|problems|findings)|whats? wrong)\b/i,
  },
  { intent: "estate", re: /\b(most|least) (active|connected|used|busy|changed)\b/i },
  {
    intent: "estate",
    re: /\b(repos?|repositor\w*)\b[^?]*\b(no|without|missing|lack\w*)\b[^?]*\b(ci\/?cd|pipeline|workflow)\b/i,
  },
  { intent: "estate", re: /\b(pipeline|ci\/?cd) coverage\b/i },
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
  if (SMALLTALK.test(question)) return "smalltalk";
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
  // Estate + advisory answer from the whole-org snapshot/findings — no entity to resolve.
  if (intent === "estate" || intent === "advisory") return { intent, question };

  const entity = await resolveEntity(port, orgId, question);
  const base: RetrievalPlan = { intent, question };
  if (entity) base.entity = entity;
  if (intent === "culprit") base.window = { sinceDays: 7 };
  return base;
}
