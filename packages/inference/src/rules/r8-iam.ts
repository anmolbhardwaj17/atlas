/**
 * R8 — assumes_role_accesses → CONNECTS_TO / STORES_IN (docs/05 §6.4, inferred-LOW).
 * A runtime ASSUMES_ROLE (observed) a role whose policy permits access to a specific
 * resource ARN we've crawled ⇒ candidate dependency. Deliberately LOW: IAM *permission*
 * is weak evidence of actual *use* (roles are over-permissioned) — valuable as a hint,
 * dangerous as fact (exactly the case P3 exists for). Wildcard-only resources are ignored.
 */
import type { InferenceInput, InferredEdge, Rule, RuleOutput } from "../types";
import { resolveResourceArn } from "./refs";

interface PolicyStatementsData {
  statements?: Array<{ effect?: string; actions?: string[]; resources?: string[] }>;
}

export const iamAccessConnectsRule: Rule = {
  key: "iam_access_connects",
  version: 1,
  evaluate(input: InferenceInput): RuleOutput {
    // role urn → runtimes that assume it (observed ASSUMES_ROLE: from=runtime, to=role).
    const runtimesByRole = new Map<string, string[]>();
    for (const e of input.observedEdges) {
      if (e.type !== "ASSUMES_ROLE") continue;
      const list = runtimesByRole.get(e.toUrn);
      if (list) list.push(e.fromUrn);
      else runtimesByRole.set(e.toUrn, [e.fromUrn]);
    }
    if (runtimesByRole.size === 0) return { nodes: [], edges: [] };

    const edges: InferredEdge[] = [];
    const seen = new Set<string>();
    for (const signal of input.signalsByKind.get("aws.iam.policy_statements") ?? []) {
      const roleUrn = signal.subjectUrn;
      const runtimes = runtimesByRole.get(roleUrn);
      if (!runtimes) continue;
      const statements = (signal.data as PolicyStatementsData).statements ?? [];
      for (const stmt of statements) {
        if (stmt.effect !== "Allow") continue;
        for (const arn of stmt.resources ?? []) {
          if (!arn || arn === "*") continue; // ignore wildcard grants (too broad, P3)
          const ref = resolveResourceArn(arn, input);
          if (!ref) continue;
          for (const runtimeUrn of runtimes) {
            const dedupe = `${runtimeUrn}->${ref.node.urn}:${ref.edgeType}`;
            if (seen.has(dedupe)) continue;
            seen.add(dedupe);
            edges.push({
              type: ref.edgeType,
              fromUrn: runtimeUrn,
              toUrn: ref.node.urn,
              tier: "inferred-low",
              evidence: { via: "iam", role: roleUrn, actions: stmt.actions ?? [], resource: arn },
            });
          }
        }
      }
    }
    return { nodes: [], edges };
  },
};
