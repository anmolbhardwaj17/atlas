/**
 * R1 — repo_deploys_to_runtime → DEPLOYS_TO (docs/05 §6.4; operational-intelligence
 * Phase A). Reads deploy signals from BOTH code hosts — `github.workflow.deploy` and
 * `bitbucket.pipeline.deploy` — and resolves each piece of evidence against the org's
 * AWS runtime nodes:
 *   - exact ARN, or a unique cluster/service (or function) name match → `inferred-high`
 *   - ECR image chain (v2): the pipeline pushes image X → ECR repo node → observed
 *     USES_IMAGE taskdef → the ECS service running that family. Two independent
 *     witnesses (push target + task wiring) and a unique service → `inferred-high`.
 *   - multiple candidates (ambiguous) → several `inferred-low` edges, never one wrong
 *     high (P3, BR-EDGE-4/5)
 * Evidence records the source signal, the raw target/image, and the match kind — the
 * full chain for ECR matches — so every edge is citable (P4).
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";

type DeployTarget =
  | { kind: "ecs"; cluster: string | null; service: string }
  | { kind: "lambda"; function: string }
  | { kind: "arn"; arn: string };

interface EcrImageRef {
  account?: string;
  region?: string;
  repository?: string;
}

interface DeploySignalData {
  repo?: string;
  targets?: DeployTarget[];
  ecrImages?: EcrImageRef[];
}

const DEPLOY_SIGNAL_KINDS = [
  "github.workflow.deploy",
  "bitbucket.pipeline.deploy",
  "jenkins.deploy",
] as const;

export const repoDeploysToRuntimeRule: Rule = {
  key: "repo_deploys_to_runtime",
  version: 2,
  evaluate(input: InferenceInput): RuleOutput {
    // Same (from,to) may be witnessed twice (name target + image chain) - keep the best tier.
    const best = new Map<string, InferredEdge>();
    const keep = (e: InferredEdge) => {
      const k = `${e.fromUrn}→${e.toUrn}`;
      const prev = best.get(k);
      if (!prev || (prev.tier === "inferred-low" && e.tier === "inferred-high")) best.set(k, e);
    };

    for (const kind of DEPLOY_SIGNAL_KINDS) {
      for (const signal of input.signalsByKind.get(kind) ?? []) {
        const data = signal.data as DeploySignalData;
        const repoUrn = data.repo;
        if (!repoUrn) continue;
        for (const target of data.targets ?? []) {
          for (const m of resolveTarget(target, input)) {
            keep({
              type: "DEPLOYS_TO",
              fromUrn: repoUrn,
              toUrn: m.urn,
              tier: m.tier,
              evidence: { source: signal.subjectUrn, target, match: m.match },
            });
          }
        }
        for (const image of data.ecrImages ?? []) {
          for (const m of resolveEcrImage(image, input)) {
            keep({
              type: "DEPLOYS_TO",
              fromUrn: repoUrn,
              toUrn: m.urn,
              tier: m.tier,
              evidence: { source: signal.subjectUrn, image, match: m.match, chain: m.chain },
            });
          }
        }
      }
    }
    return { nodes: [], edges: [...best.values()] };
  },
};

interface Match {
  urn: string;
  tier: "inferred-high" | "inferred-low";
  match: string;
  /** For ECR-image matches: the citable resolution path (ecr repo → taskdef → service). */
  chain?: Record<string, unknown>;
}

/**
 * ECR image chain (v2): image {account,region,repository} → ECR repo URN → taskdefs with
 * an observed USES_IMAGE edge onto it → ECS services whose taskDefinition ARN names that
 * family. One service → high (the push target and the task wiring independently agree);
 * several → low each; broken chain → nothing (P3).
 */
function resolveEcrImage(image: EcrImageRef, input: InferenceInput): Match[] {
  const { account, region, repository } = image;
  if (!account || !region || !repository) return [];
  const ecrUrn = `aws:${region}:${account}:ecr:${repository}`;
  if (!input.nodesByUrn.has(ecrUrn)) return [];

  // Which task-definition families run this image? (observed USES_IMAGE, I1.3)
  const families = new Set<string>();
  for (const e of input.observedEdges) {
    if (e.type !== "USES_IMAGE" || e.toUrn !== ecrUrn) continue;
    const family = e.fromUrn.split(":ecs-taskdef:")[1];
    if (family) families.add(family);
  }
  if (families.size === 0) return [];

  const services = (input.nodesByKind.get("aws.ecs.service") ?? []).filter((n) => {
    const td = n.attributes.taskDefinition;
    if (typeof td !== "string") return false;
    const m = /task-definition\/([^:/]+)/.exec(td);
    return m?.[1] != null && families.has(m[1]);
  });

  const chain = { ecrRepository: ecrUrn, taskdefFamilies: [...families] };
  if (services.length === 1) {
    return [
      { urn: (services[0] as NodeLite).urn, tier: "inferred-high", match: "ecr-image", chain },
    ];
  }
  return services.map((n) => ({
    urn: n.urn,
    tier: "inferred-low" as const,
    match: "ecr-image-ambiguous",
    chain,
  }));
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
