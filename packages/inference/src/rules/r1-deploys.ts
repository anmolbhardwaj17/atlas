/**
 * R1 — repo_deploys_to_runtime → DEPLOYS_TO (docs/05 §6.4). Reads the
 * `github.workflow.deploy` signals (emitted by the GitHub connector) and resolves each
 * deploy target against the org's AWS runtime nodes:
 *   - exact ARN, or a unique cluster/service (or function) name match → `inferred-high`
 *   - multiple candidates (ambiguous) → several `inferred-low` edges, never one wrong
 *     high (P3, BR-EDGE-4/5)
 * Evidence records the workflow, the raw target, and the match kind (for citations, P4).
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";

type DeployTarget =
  | { kind: "ecs"; cluster: string | null; service: string }
  | { kind: "lambda"; function: string }
  | { kind: "arn"; arn: string };

interface DeploySignalData {
  repo?: string;
  targets?: DeployTarget[];
}

export const repoDeploysToRuntimeRule: Rule = {
  key: "repo_deploys_to_runtime",
  version: 1,
  evaluate(input: InferenceInput): RuleOutput {
    const edges: InferredEdge[] = [];
    for (const signal of input.signalsByKind.get("github.workflow.deploy") ?? []) {
      const data = signal.data as DeploySignalData;
      const repoUrn = data.repo;
      if (!repoUrn) continue;
      for (const target of data.targets ?? []) {
        for (const m of resolveTarget(target, input)) {
          edges.push({
            type: "DEPLOYS_TO",
            fromUrn: repoUrn,
            toUrn: m.urn,
            tier: m.tier,
            evidence: { workflow: signal.subjectUrn, target, match: m.match },
          });
        }
      }
    }
    return { nodes: [], edges };
  },
};

interface Match {
  urn: string;
  tier: "inferred-high" | "inferred-low";
  match: string;
}

function resolveTarget(target: DeployTarget, input: InferenceInput): Match[] {
  if (target.kind === "arn") {
    const urn = arnToUrn(target.arn);
    // Exact ARN that resolves to a known node → highest inferred confidence.
    return urn && input.nodesByUrn.has(urn) ? [{ urn, tier: "inferred-high", match: "arn" }] : [];
  }
  if (target.kind === "ecs") {
    const candidates = (input.nodesByKind.get("aws.ecs.service") ?? []).filter((n) => {
      if (n.attributes.serviceName !== target.service) return false;
      return target.cluster == null || n.attributes.cluster === target.cluster;
    });
    return tierByCount(candidates, "ecs-name");
  }
  // lambda
  const candidates = (input.nodesByKind.get("aws.lambda.function") ?? []).filter(
    (n) => n.attributes.functionName === target.function,
  );
  return tierByCount(candidates, "lambda-name");
}

/** One match → high (unambiguous name); many → low each (ambiguous, P3). */
function tierByCount(candidates: NodeLite[], match: string): Match[] {
  if (candidates.length === 1) {
    return [{ urn: (candidates[0] as NodeLite).urn, tier: "inferred-high", match }];
  }
  return candidates.map((n) => ({
    urn: n.urn,
    tier: "inferred-low" as const,
    match: `${match}-ambiguous`,
  }));
}

/** Map an ECS-service / Lambda ARN to its Atlas URN (docs/05 §2.2), or null. */
function arnToUrn(arn: string): string | null {
  const ecs = /^arn:aws[a-z-]*:ecs:([a-z0-9-]+):(\d{12}):service\/(.+)$/.exec(arn);
  if (ecs && ecs[3]?.includes("/")) {
    return `aws:${ecs[1]}:${ecs[2]}:ecs-service:${ecs[3]}`;
  }
  const lambda = /^arn:aws[a-z-]*:lambda:([a-z0-9-]+):(\d{12}):function:([^:]+)/.exec(arn);
  if (lambda) return `aws:${lambda[1]}:${lambda[2]}:lambda:${lambda[3]}`;
  return null;
}
