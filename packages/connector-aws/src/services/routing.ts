/**
 * Routing service modules: ELB (ALB/NLB) and Route53 (docs/06 §4).
 * - ELB emits ROUTES_TO(elb→instance) for instance targets and PROTECTS(sg→elb).
 * - Route53 alias targets are emitted as a SIGNAL (not an observed edge): an alias
 *   DNS name (e.g. `<name>-<hash>.<region>.elb.amazonaws.com`) does not deterministically
 *   resolve to a specific ELB node, so we prefer a signal for R-routing inference over a
 *   possibly-wrong observed edge (P3 — a missing edge beats a wrong one).
 */
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";
import { observed } from "./helpers";

interface LoadBalancer {
  LoadBalancerName: string;
  LoadBalancerArn?: string;
  DNSName?: string;
  Type?: string;
  Scheme?: string;
  VpcId?: string;
  SecurityGroups?: string[];
  /** Enriched at fetch-detail: target groups + resolved targets. */
  TargetGroups?: Array<{
    TargetGroupArn?: string;
    TargetType?: string;
    Targets?: Array<{ Id?: string; Port?: number }>;
  }>;
}

export const elbModule: ServiceModule<LoadBalancer> = {
  kind: "aws.elb",
  service: "elb",
  scope: "region",
  normalize({ account, region, data }) {
    return {
      urn: awsUrn("aws.elb", { account, region, naturalKey: data.LoadBalancerName }),
      kind: "aws.elb",
      displayName: data.LoadBalancerName,
      attributes: {
        region,
        accountRef: account,
        loadBalancerName: data.LoadBalancerName,
        dnsName: data.DNSName,
        type: data.Type,
        scheme: data.Scheme,
        vpcId: data.VpcId,
      },
    };
  },
  observedEdges({ account, region, data }) {
    const self = awsUrn("aws.elb", { account, region, naturalKey: data.LoadBalancerName });
    const edges = [];
    for (const sgId of data.SecurityGroups ?? []) {
      const sgUrn = awsUrn("aws.securitygroup", { account, region, naturalKey: sgId });
      edges.push(observed("PROTECTS", sgUrn, self));
    }
    for (const tg of data.TargetGroups ?? []) {
      if (tg.TargetType !== "instance") continue; // 'ip'/'lambda' targets handled elsewhere
      for (const t of tg.Targets ?? []) {
        if (!t.Id) continue;
        const instUrn = awsUrn("aws.ec2.instance", { account, region, naturalKey: t.Id });
        edges.push(observed("ROUTES_TO", self, instUrn, { targetGroupArn: tg.TargetGroupArn }));
      }
    }
    return edges;
  },
  extractSignals() {
    return [];
  },
};

interface Route53Record {
  Name: string;
  Type: string;
  HostedZoneId: string;
  AliasTarget?: { DNSName?: string; HostedZoneId?: string };
  ResourceRecords?: Array<{ Value?: string }>;
}

export const route53Module: ServiceModule<Route53Record> = {
  kind: "aws.route53.record",
  service: "route53",
  scope: "global",
  normalize({ account, data }) {
    const key = `${data.HostedZoneId}/${data.Name}/${data.Type}`;
    return {
      urn: awsUrn("aws.route53.record", { account, naturalKey: key }),
      kind: "aws.route53.record",
      displayName: `${data.Name} (${data.Type})`,
      attributes: {
        region: "global",
        accountRef: account,
        name: data.Name,
        type: data.Type,
        hostedZoneId: data.HostedZoneId,
        aliasTarget: data.AliasTarget?.DNSName ?? null,
        records: (data.ResourceRecords ?? []).map((r) => r.Value).filter(Boolean),
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals({ account, data }) {
    const target = data.AliasTarget?.DNSName ?? (data.ResourceRecords ?? [])[0]?.Value;
    if (!target) return [];
    const subjectUrn = awsUrn("aws.route53.record", {
      account,
      naturalKey: `${data.HostedZoneId}/${data.Name}/${data.Type}`,
    });
    return [{ kind: "aws.route53.alias", subjectUrn, data: { target } }];
  },
};
