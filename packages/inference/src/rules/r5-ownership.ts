/**
 * R5 (propagation) — ownership_propagation → OWNED_BY (docs/05 §6.4, inferred-high).
 * Repo→team ownership is OBSERVED (CODEOWNERS, emitted by the connector). Propagating it
 * to the logical service the repo IMPLEMENTS is the inferred step: for each IMPLEMENTS
 * (repo→service) and observed OWNED_BY (repo→team/user), emit OWNED_BY (service→owner).
 */
import type { InferenceInput, InferredEdge, Rule, RuleOutput } from "../types";

export const ownershipPropagationRule: Rule = {
  key: "ownership_propagation",
  version: 1,
  consumesKinds: [],
  consumesSignalKinds: [],
  evaluate(input: InferenceInput): RuleOutput {
    // repo → [owner urns] from observed OWNED_BY.
    const ownersByRepo = new Map<string, string[]>();
    for (const e of input.observedEdges) {
      if (e.type !== "OWNED_BY") continue;
      const list = ownersByRepo.get(e.fromUrn);
      if (list) list.push(e.toUrn);
      else ownersByRepo.set(e.fromUrn, [e.toUrn]);
    }

    const edges: InferredEdge[] = [];
    const seen = new Set<string>();
    for (const impl of input.inferredEdges) {
      if (impl.type !== "IMPLEMENTS") continue;
      const repoUrn = impl.fromUrn;
      const serviceUrn = impl.toUrn;
      for (const ownerUrn of ownersByRepo.get(repoUrn) ?? []) {
        const dedupe = `${serviceUrn}->${ownerUrn}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        edges.push({
          type: "OWNED_BY",
          fromUrn: serviceUrn,
          toUrn: ownerUrn,
          tier: "inferred-high",
          evidence: { via: repoUrn, source: "CODEOWNERS" },
        });
      }
    }
    return { nodes: [], edges };
  },
};
