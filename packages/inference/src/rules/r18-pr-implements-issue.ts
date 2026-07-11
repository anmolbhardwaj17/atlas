/**
 * R18 — pr_implements_issue → IMPLEMENTS (Intent Verification, docs/plans/intent-verification.md).
 *
 * Links a pull request to the Jira issue it implements, so the graph holds intent ↔ code ↔ runtime in
 * one cited structure. This slice is the DETERMINISTIC tier: an explicit Jira key (`PROJ-123`) in the
 * PR's title or source branch that matches a crawled `jira.issue` → `IMPLEMENTS(pr → issue)` at
 * `inferred-high` (near-certain — the author named the ticket). Fuzzy linking (no key: branch/temporal/
 * author/semantic) is a later, low-tier slice + the confirm/reject loop (P3 — a missing edge over a
 * wrong one). A key that matches no crawled issue yields nothing.
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";

const PR_KINDS = ["bitbucket.pullrequest", "github.pull_request"];
/** A Jira issue key: 1–10 upper-alnum project code, a dash, digits (e.g. ENG-142, AB1-7). */
const KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

/** Distinct Jira keys mentioned in a PR's title (name) + source branch. */
export function keysFromPr(pr: NodeLite): string[] {
  const branch = typeof pr.attributes.sourceBranch === "string" ? pr.attributes.sourceBranch : "";
  const text = `${pr.name ?? ""} ${branch}`.toUpperCase();
  const out = new Set<string>();
  for (const m of text.match(KEY_RE) ?? []) out.add(m);
  return [...out];
}

export const prImplementsIssueRule: Rule = {
  key: "pr_implements_issue",
  version: 1,
  evaluate(input: InferenceInput): RuleOutput {
    const issues = input.nodesByKind.get("jira.issue") ?? [];
    if (issues.length === 0) return { nodes: [], edges: [] };

    // issue key (upper) → issue node.
    const issueByKey = new Map<string, NodeLite>();
    for (const issue of issues) {
      const key = String(issue.attributes.key ?? "").toUpperCase();
      if (key) issueByKey.set(key, issue);
    }
    if (issueByKey.size === 0) return { nodes: [], edges: [] };

    const edges: InferredEdge[] = [];
    for (const kind of PR_KINDS) {
      for (const pr of input.nodesByKind.get(kind) ?? []) {
        for (const key of keysFromPr(pr)) {
          const issue = issueByKey.get(key);
          if (!issue) continue;
          edges.push({
            type: "IMPLEMENTS",
            fromUrn: pr.urn,
            toUrn: issue.urn,
            tier: "inferred-high",
            evidence: { rule: "pr-implements-issue", match: "explicit-key", key },
          });
        }
      }
    }
    return { nodes: [], edges };
  },
};
