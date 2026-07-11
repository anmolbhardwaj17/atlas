/**
 * Fuzzy PR↔issue linking (IV-4, docs/plans/intent-verification.md §1 — the low tier). When a PR
 * carries NO explicit Jira key (so R18's deterministic tier found nothing), we still want to link it
 * to the ticket it implements. This proposes candidates from DETERMINISTIC signals — the title/branch
 * sharing meaningful words with the ticket summary, and temporal proximity (a PR can't implement a
 * ticket filed well after it opened) — and emits them as CANDIDATES the user confirms/rejects via the
 * AI-suggested-edge loop (badged `ai-suggested`, below inferred-low). Precision is the human's job by
 * design (P3 — a missing edge over a wrong one); this side just needs to surface plausible matches
 * without noise, so it demands ≥2 shared meaningful words AND a clear winner over the runner-up.
 *
 * Pure + NestJS-free (mirrors edge-matcher.ts). No LLM: the signals are string/date deterministic, so
 * the result is stable and testable. (Author↔assignee, a third signal in the plan, waits on the PR
 * connector capturing the author — not stored today.)
 */

export interface FuzzyPr {
  id: string;
  urn: string;
  /** PR title (the node name). */
  title: string;
  /** Source branch (often carries the feature name), or "". */
  branch: string;
  /** ISO open date, or null. */
  createdAt: string | null;
}

export interface FuzzyIssue {
  id: string;
  urn: string;
  key: string;
  summary: string;
  /** ISO created date, or null. */
  createdAt: string | null;
}

export interface IntentLinkSuggestion {
  prId: string;
  prUrn: string;
  issueId: string;
  issueUrn: string;
  issueKey: string;
  /** 0..1 combined signal strength (for ordering / thresholds), not a trust claim. */
  score: number;
  /** Human-verifiable reasoning stored as provenance (why we think it links). */
  reasoning: string;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "as",
  "is",
  "are",
  "be",
  "add",
  "adds",
  "added",
  "fix",
  "fixes",
  "fixed",
  "fixing",
  "update",
  "updates",
  "updated",
  "change",
  "changes",
  "changed",
  "remove",
  "removes",
  "removed",
  "refactor",
  "refactors",
  "wip",
  "feat",
  "feature",
  "bug",
  "bugfix",
  "hotfix",
  "chore",
  "test",
  "tests",
  "pr",
  "pull",
  "request",
  "merge",
  "into",
  "new",
  "use",
  "using",
  "make",
  "support",
  "improve",
  "create",
  "implement",
  "implements",
  "implementation",
  "enable",
  "allow",
  "set",
  "get",
  "run",
]);

const BRANCH_PREFIX = /^(feature|feat|bugfix|hotfix|fix|release|chore|task|story|dev|develop)[/-]/i;
/** A Jira key already handled by R18's deterministic tier — strip it so fuzzy scores the words, and
 *  so a PR that DOES carry a key isn't fuzzily linked to a DIFFERENT ticket. */
const KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

/** Significant lowercase word tokens (len ≥ 3, not a stopword, not purely numeric). */
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/gi) ?? []) {
    if (raw.length < 3 || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    out.add(raw);
  }
  return out;
}

function prTokens(pr: FuzzyPr): Set<string> {
  const title = pr.title.replace(KEY_RE, " ");
  const branch = pr.branch.replace(BRANCH_PREFIX, " ").replace(KEY_RE, " ");
  return tokenize(`${title} ${branch.replace(/[/_-]+/g, " ")}`);
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return (ta - tb) / 86_400_000;
}

export interface IntentLinkOpts {
  /** Min shared meaningful words to consider a match at all. */
  minShared?: number;
  /** Min combined score to emit. */
  minScore?: number;
  /** The best candidate must beat the runner-up by at least this ratio (clear winner → P3). */
  marginRatio?: number;
}

/**
 * Propose fuzzy PR→issue links. `prs` must be the PRs with NO explicit-key link already (the caller
 * excludes linked ones). Returns at most one suggestion per PR — the single best issue, only when it
 * clears the thresholds and clearly beats the runner-up. Deterministic; [] on empty input.
 */
export function suggestIntentLinks(
  prs: FuzzyPr[],
  issues: FuzzyIssue[],
  opts: IntentLinkOpts = {},
): IntentLinkSuggestion[] {
  const minShared = opts.minShared ?? 2;
  const minScore = opts.minScore ?? 0.4;
  const marginRatio = opts.marginRatio ?? 1.5;
  if (prs.length === 0 || issues.length === 0) return [];

  const issueTokens = issues.map((i) => ({ issue: i, tokens: tokenize(i.summary) }));
  const out: IntentLinkSuggestion[] = [];

  for (const pr of prs) {
    const pt = prTokens(pr);
    if (pt.size === 0) continue;

    let best: { issue: FuzzyIssue; score: number; shared: string[] } | null = null;
    let secondScore = 0;

    for (const { issue, tokens } of issueTokens) {
      if (tokens.size === 0) continue;
      const shared = [...pt].filter((t) => tokens.has(t));
      if (shared.length < minShared) continue;

      // Word-overlap over the smaller vocabulary (rewards a PR that covers the ticket's key terms),
      // then a temporal adjustment: a PR opened close after the ticket is likelier; one opened well
      // BEFORE the ticket existed can't implement it (strong penalty).
      const overlap = shared.length / Math.min(pt.size, tokens.size);
      let score = overlap;
      const gap = daysBetween(pr.createdAt, issue.createdAt); // pr − issueCreated, in days
      if (gap !== null) {
        if (gap < -2)
          score *= 0.25; // PR clearly predates the ticket
        else if (gap <= 45)
          score = Math.min(1, score + 0.15); // opened soon after → boost
        else if (gap > 180) score *= 0.7; // very stale pairing
      }

      if (!best || score > best.score) {
        secondScore = best ? best.score : secondScore;
        best = { issue, score, shared };
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    if (!best || best.score < minScore) continue;
    if (secondScore > 0 && best.score < secondScore * marginRatio) continue; // ambiguous → skip (P3)

    out.push({
      prId: pr.id,
      prUrn: pr.urn,
      issueId: best.issue.id,
      issueUrn: best.issue.urn,
      issueKey: best.issue.key,
      score: Math.round(best.score * 100) / 100,
      reasoning: reasoningFor(pr, best.issue, best.shared),
    });
  }
  return out;
}

function reasoningFor(pr: FuzzyPr, issue: FuzzyIssue, shared: string[]): string {
  const words = shared.slice(0, 5).join(", ");
  const gap = daysBetween(pr.createdAt, issue.createdAt);
  const timing =
    gap !== null && gap >= -2 && gap <= 45
      ? ` It opened ${gap < 1 ? "the same day as" : `${Math.round(gap)} day(s) after`} the ticket was created.`
      : "";
  return `No explicit key, but this PR shares "${words}" with ${issue.key} ("${issue.summary.slice(0, 80)}").${timing} Confirm if it implements this ticket.`;
}
