/**
 * R15 — alb_routes_to_service → ROUTES_TO(elb→ecs.service), inferred-high (docs/05 §6.4).
 *
 * A load balancer and an ECS service that share a TARGET GROUP are wired together: the ALB forwards
 * to that target group, and the service registers its tasks into it. The connector can't emit this
 * as an observed edge (an ELB target lists ENIs/IPs, not the service ARN), so each side publishes
 * its target-group ARNs as a signal — the ELB via `aws.elb.targetgroups`, the service via
 * `aws.ecs.targetgroups` — and this rule joins them by shared ARN. An exact ARN match is strong
 * evidence (inferred-high). This is the missing link that lets exposure inference (R16) reach an
 * ECS service sitting behind an internet-facing ALB — the toxic-combination path.
 */
import type { InferenceInput, InferredEdge, Rule, RuleOutput } from "../types";

interface TargetGroupSignal {
  targetGroupArns?: unknown;
}

const arnsOf = (data: TargetGroupSignal): string[] =>
  Array.isArray(data.targetGroupArns)
    ? data.targetGroupArns.filter((a): a is string => typeof a === "string")
    : [];

export const albRoutesToServiceRule: Rule = {
  key: "alb_routes_to_service",
  version: 1,
  evaluate(input: InferenceInput): RuleOutput {
    const elbSignals = input.signalsByKind.get("aws.elb.targetgroups") ?? [];
    const svcSignals = input.signalsByKind.get("aws.ecs.targetgroups") ?? [];
    if (elbSignals.length === 0 || svcSignals.length === 0) return { nodes: [], edges: [] };

    // target-group ARN → the ECS service urns registered into it.
    const servicesByTg = new Map<string, string[]>();
    for (const s of svcSignals) {
      for (const arn of arnsOf(s.data as TargetGroupSignal)) {
        const list = servicesByTg.get(arn);
        if (list) list.push(s.subjectUrn);
        else servicesByTg.set(arn, [s.subjectUrn]);
      }
    }

    const edges: InferredEdge[] = [];
    const seen = new Set<string>();
    for (const elb of elbSignals) {
      for (const arn of arnsOf(elb.data as TargetGroupSignal)) {
        for (const serviceUrn of servicesByTg.get(arn) ?? []) {
          const dedupe = `${elb.subjectUrn}->${serviceUrn}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          edges.push({
            type: "ROUTES_TO",
            fromUrn: elb.subjectUrn,
            toUrn: serviceUrn,
            tier: "inferred-high",
            evidence: { via: "target-group", targetGroupArn: arn },
          });
        }
      }
    }
    return { nodes: [], edges };
  },
};
