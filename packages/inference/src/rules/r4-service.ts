/**
 * R4 — service_derivation → atlas.service node + IMPLEMENTS/RUNS (docs/05 §6.4, DD-1).
 * From each HIGH-confidence DEPLOYS_TO(repo→runtime) (produced by R1 this run), derive a
 * logical service node `atlas:<org-slug>:service:<repo-name>` and link
 * repo IMPLEMENTS service + runtime RUNS service. Minimal (DD-1): only high-confidence
 * deploys produce a service — the service is only as trustworthy as its deploy link.
 */
import type { InferenceInput, InferredEdge, DerivedNode, Rule, RuleOutput } from "../types";

/** Service key = the repo's short name (owner/repo → repo). Deterministic per repo. */
function serviceKey(repoUrn: string): string | null {
  // repoUrn = github:<owner>/<repo>
  const m = /^github:[^/]+\/(.+)$/.exec(repoUrn);
  return m ? (m[1] as string) : null;
}

export const serviceDerivationRule: Rule = {
  key: "service_derivation",
  version: 1,
  consumesKinds: [],
  consumesSignalKinds: [],
  evaluate(input: InferenceInput): RuleOutput {
    const nodes: DerivedNode[] = [];
    const edges: InferredEdge[] = [];
    const seenService = new Set<string>();

    for (const edge of input.inferredEdges) {
      if (edge.type !== "DEPLOYS_TO" || edge.tier !== "inferred-high") continue;
      const repoUrn = edge.fromUrn;
      const runtimeUrn = edge.toUrn;
      const key = serviceKey(repoUrn);
      if (!key || !input.orgSlug) continue;
      const serviceUrn = `atlas:${input.orgSlug}:service:${key}`;

      if (!seenService.has(serviceUrn)) {
        seenService.add(serviceUrn);
        nodes.push({
          urn: serviceUrn,
          kind: "atlas.service",
          displayName: key,
          attributes: { key, derivedFrom: repoUrn },
          tier: "inferred-high",
        });
        edges.push({
          type: "IMPLEMENTS",
          fromUrn: repoUrn,
          toUrn: serviceUrn,
          tier: "inferred-high",
          evidence: { via: "DEPLOYS_TO", repo: repoUrn },
        });
      }
      edges.push({
        type: "RUNS",
        fromUrn: runtimeUrn,
        toUrn: serviceUrn,
        tier: "inferred-high",
        evidence: { via: "DEPLOYS_TO", runtime: runtimeUrn },
      });
    }
    return { nodes, edges };
  },
};
