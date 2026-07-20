/**
 * R6 — pr_changes_service → CHANGED_BY (docs/05 §6.4). A merged PR in a repo that
 * IMPLEMENTS a service marks the service CHANGED_BY the PR (service → pull_request,
 * docs/05 §4.1). Powers US-5 ("what changed") / US-6 ("culprit PR"). Confidence: high
 * when the repo implements exactly one service; low for a monorepo (many services) —
 * honest uncertainty for culprit attribution (P3, US-6).
 */
import type { InferenceInput, InferredEdge, Rule, RuleOutput } from "../types";

interface PrFilesData {
  files?: string[];
  mergedAt?: string | null;
}

/** repoUrn from a PR urn: github:<owner>/<repo>:pr:<n> → github:<owner>/<repo>. */
function repoOfPr(prUrn: string): string | null {
  const m = /^(github:[^/]+\/[^:]+):pr:\d+$/.exec(prUrn);
  return m ? (m[1] as string) : null;
}

export const prChangesServiceRule: Rule = {
  key: "pr_changes_service",
  version: 1,
  consumesKinds: [],
  consumesSignalKinds: ["github.pr.files"],
  evaluate(input: InferenceInput): RuleOutput {
    // repo → services it IMPLEMENTS (from R4 this run).
    const servicesByRepo = new Map<string, string[]>();
    for (const e of input.inferredEdges) {
      if (e.type !== "IMPLEMENTS") continue;
      const list = servicesByRepo.get(e.fromUrn);
      if (list) list.push(e.toUrn);
      else servicesByRepo.set(e.fromUrn, [e.toUrn]);
    }

    const edges: InferredEdge[] = [];
    for (const signal of input.signalsByKind.get("github.pr.files") ?? []) {
      const data = signal.data as PrFilesData;
      if (!data.mergedAt) continue; // only merged PRs (docs/05 §6.4)
      const prUrn = signal.subjectUrn;
      const repoUrn = repoOfPr(prUrn);
      if (!repoUrn) continue;
      const services = servicesByRepo.get(repoUrn) ?? [];
      const tier = services.length === 1 ? "inferred-high" : "inferred-low";
      for (const serviceUrn of services) {
        edges.push({
          type: "CHANGED_BY",
          fromUrn: serviceUrn,
          toUrn: prUrn,
          tier,
          evidence: { pr: prUrn, files: data.files ?? [], mergedAt: data.mergedAt },
        });
      }
    }
    return { nodes: [], edges };
  },
};
