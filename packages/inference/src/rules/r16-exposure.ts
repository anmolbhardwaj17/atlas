/**
 * R16 — internet_exposure → EXPOSED_VIA(resource→sg|elb), inferred-high (docs/05 §6.4).
 *
 * Derives which compute resources are reachable from the public internet — the cloud-posture half of
 * the "exposed AND vulnerable" toxic combination (docs/plans/security-vulnerabilities.md). Two
 * definite paths only (P3 — a missing exposure beats a wrong one; we do NOT guess from public IPs or
 * subnets, which aren't crawled):
 *
 *  1. **World-open security group** — a resource PROTECTS-ed by a SG whose `aws.sg.rules` ingress
 *     allows `0.0.0.0/0`/`::/0` → EXPOSED_VIA(resource→sg).
 *  2. **Internet-facing load balancer** — a resource that an `internet-facing` ELB/ALB ROUTES_TO
 *     (observed elb→instance, or R15's inferred alb→service) → EXPOSED_VIA(resource→elb).
 *
 * The edge is the product: it makes exposure a first-class, citable graph fact the toxic-combination
 * finding and Ask AI both build on, rather than a one-off dashboard string (P1/P4).
 */
import type { EdgeLite, InferenceInput, InferredEdge, Rule, RuleOutput } from "../types";

interface SgRule {
  fromPort?: number | null;
  toPort?: number | null;
  cidrs?: string[];
}

const WORLD_CIDRS = new Set(["0.0.0.0/0", "::/0"]);
const COMPUTE_KINDS = new Set(["aws.ec2.instance", "aws.lambda.function", "aws.ecs.service"]);

export const internetExposureRule: Rule = {
  key: "internet_exposure",
  version: 1,
  consumesKinds: ["aws.elb", ...COMPUTE_KINDS],
  consumesSignalKinds: ["aws.sg.rules"],
  evaluate(input: InferenceInput): RuleOutput {
    const isCompute = (urn: string): boolean =>
      COMPUTE_KINDS.has(input.nodesByUrn.get(urn)?.kind ?? "");

    const edges: InferredEdge[] = [];
    const seen = new Set<string>();
    const emit = (resource: string, exposer: string, evidence: Record<string, unknown>): void => {
      if (!isCompute(resource)) return;
      const key = `${resource}->${exposer}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({
        type: "EXPOSED_VIA",
        fromUrn: resource,
        toUrn: exposer,
        tier: "inferred-high",
        evidence,
      });
    };

    // (1) World-open SGs → the resources they protect.
    const openPortsBySg = new Map<string, string>();
    for (const sig of input.signalsByKind.get("aws.sg.rules") ?? []) {
      const rules = (sig.data as { ingress?: SgRule[] }).ingress ?? [];
      const openPorts = new Set<string>();
      for (const r of rules) {
        if (!(r.cidrs ?? []).some((c) => WORLD_CIDRS.has(c))) continue;
        openPorts.add(
          r.toPort == null && r.fromPort == null ? "all" : String(r.toPort ?? r.fromPort),
        );
      }
      if (openPorts.size > 0) openPortsBySg.set(sig.subjectUrn, [...openPorts].join(", "));
    }
    for (const e of input.observedEdges) {
      if (e.type !== "PROTECTS") continue;
      const ports = openPortsBySg.get(e.fromUrn);
      if (ports === undefined) continue;
      emit(e.toUrn, e.fromUrn, { via: "world-open-sg", ports });
    }

    // (2) Internet-facing load balancers → the resources they route to (observed + R15-inferred).
    const publicElbUrns = new Set<string>();
    for (const elb of input.nodesByKind.get("aws.elb") ?? []) {
      if (elb.attributes.scheme === "internet-facing") publicElbUrns.add(elb.urn);
    }
    const routes: EdgeLite[] = [...input.observedEdges, ...input.inferredEdges];
    for (const e of routes) {
      if (e.type !== "ROUTES_TO" || !publicElbUrns.has(e.fromUrn)) continue;
      emit(e.toUrn, e.fromUrn, { via: "internet-facing-lb" });
    }

    return { nodes: [], edges };
  },
};
