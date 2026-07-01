/**
 * R2 — sg_correlation_connects → CONNECTS_TO (docs/05 §6.4, inferred-high). If a compute
 * resource A's security group is allowed (ingress) into a datastore B's SG on B's engine
 * port, and they share a VPC, then A can reach B ⇒ A CONNECTS_TO B. High (network
 * reachability is strong structural evidence) — but not observed: SG *allows* ≠ *uses* (P3).
 *
 * Wiring: PROTECTS(sg→resource) observed edges give SG↔resource attachment; `aws.sg.rules`
 * signals give each SG's ingress (ports + source SG group refs); RDS nodes give the engine
 * port. The client compute node is whatever the *source* SG protects.
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";
import { portForEngine } from "./refs";

interface SgRule {
  protocol?: string;
  fromPort?: number | null;
  toPort?: number | null;
  groupRefs?: string[];
}
interface SgRulesData {
  ingress?: SgRule[];
}

const COMPUTE_KINDS = new Set(["aws.ec2.instance", "aws.lambda.function", "aws.ecs.service"]);

export const sgCorrelationConnectsRule: Rule = {
  key: "sg_correlation_connects",
  version: 1,
  evaluate(input: InferenceInput): RuleOutput {
    const rds = input.nodesByKind.get("aws.rds.instance") ?? [];
    if (rds.length === 0) return { nodes: [], edges: [] };

    // sgUrn → protected resource urns; groupId → sgUrn; sgUrn → ingress rules.
    const protectedBySg = new Map<string, string[]>();
    const sgsByResource = new Map<string, string[]>();
    for (const e of input.observedEdges) {
      if (e.type !== "PROTECTS") continue;
      push(protectedBySg, e.fromUrn, e.toUrn);
      push(sgsByResource, e.toUrn, e.fromUrn);
    }
    const sgUrnByGroupId = new Map<string, string>();
    for (const sg of input.nodesByKind.get("aws.securitygroup") ?? []) {
      const gid = sg.attributes.groupId;
      if (typeof gid === "string") sgUrnByGroupId.set(gid, sg.urn);
    }
    const ingressBySg = new Map<string, SgRule[]>();
    for (const signal of input.signalsByKind.get("aws.sg.rules") ?? []) {
      ingressBySg.set(signal.subjectUrn, (signal.data as SgRulesData).ingress ?? []);
    }

    const edges: InferredEdge[] = [];
    const seen = new Set<string>();

    for (const db of rds) {
      const port =
        typeof db.attributes.endpointPort === "number"
          ? db.attributes.endpointPort
          : portForEngine(db.attributes.engine as string | undefined);
      if (port == null) continue;
      const dbVpc = db.attributes.vpcId;

      for (const sgB of sgsByResource.get(db.urn) ?? []) {
        for (const rule of ingressBySg.get(sgB) ?? []) {
          if (!ruleAllowsPort(rule, port)) continue;
          for (const sourceGroupId of rule.groupRefs ?? []) {
            const sgAUrn = sgUrnByGroupId.get(sourceGroupId);
            if (!sgAUrn) continue;
            for (const clientUrn of protectedBySg.get(sgAUrn) ?? []) {
              const client = input.nodesByUrn.get(clientUrn);
              if (!client || !COMPUTE_KINDS.has(client.kind) || client.urn === db.urn) continue;
              if (!sameVpc(client, dbVpc)) continue;
              const dedupe = `${client.urn}->${db.urn}`;
              if (seen.has(dedupe)) continue;
              seen.add(dedupe);
              edges.push({
                type: "CONNECTS_TO",
                fromUrn: client.urn,
                toUrn: db.urn,
                tier: "inferred-high",
                evidence: { via: "sg", port, sourceSg: sourceGroupId },
              });
            }
          }
        }
      }
    }
    return { nodes: [], edges };
  },
};

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** A rule allows `port` if it's an all-traffic rule or its port range covers it. */
function ruleAllowsPort(rule: SgRule, port: number): boolean {
  const { fromPort, toPort } = rule;
  if (fromPort == null && toPort == null) return true; // all ports (e.g. protocol -1)
  return (fromPort == null || fromPort <= port) && (toPort == null || toPort >= port);
}

/** Same-VPC reachability guard: require equality only when both VPCs are known. */
function sameVpc(client: NodeLite, dbVpc: unknown): boolean {
  const clientVpc = client.attributes.vpcId;
  if (typeof dbVpc !== "string" || typeof clientVpc !== "string") return true;
  return clientVpc === dbVpc;
}
