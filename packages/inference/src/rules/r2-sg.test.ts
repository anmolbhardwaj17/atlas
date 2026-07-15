import { describe, it, expect } from "vitest";
import { sgCorrelationConnectsRule } from "./r2-sg";
import type { EdgeLite, InferenceInput, NodeLite, SignalLite } from "../types";

function makeInput(
  nodes: NodeLite[],
  signals: SignalLite[],
  observedEdges: EdgeLite[] = [],
): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of nodes) {
    nodesByUrn.set(n.urn, n);
    const list = nodesByKind.get(n.kind) ?? [];
    list.push(n);
    nodesByKind.set(n.kind, list);
  }
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of signals) {
    const list = signalsByKind.get(s.kind) ?? [];
    list.push(s);
    signalsByKind.set(s.kind, list);
  }
  return {
    orgSlug: "acme",
    nodesByUrn,
    nodesByKind,
    signals,
    signalsByKind,
    observedEdges,
    inferredEdges: [],
  };
}
const node = (urn: string, kind: string, attributes: Record<string, unknown>): NodeLite => ({
  id: urn,
  urn,
  kind,
  attributes,
});
const protects = (sgUrn: string, resourceUrn: string): EdgeLite => ({
  fromUrn: sgUrn,
  toUrn: resourceUrn,
  type: "PROTECTS",
});

const EC2 = "aws:us-east-1:1:ec2:web";
const RDS = "aws:us-east-1:1:rds:orders";
const SG_A = "aws:us-east-1:1:sg:web-sg"; // client SG
const SG_B = "aws:us-east-1:1:sg:db-sg"; // datastore SG

/** A DB reachable from EC2: EC2←SG_A, RDS←SG_B, SG_B ingress allows SG_A group on 5432, same VPC. */
function reachable(overrides?: {
  ingress?: unknown;
  rdsAttrs?: Record<string, unknown>;
  ec2Vpc?: string;
}) {
  const rdsAttrs = overrides?.rdsAttrs ?? { engine: "postgres", vpcId: "vpc-1" };
  return makeInput(
    [
      node(EC2, "aws.ec2.instance", { vpcId: overrides?.ec2Vpc ?? "vpc-1" }),
      node(RDS, "aws.rds.instance", rdsAttrs),
      node(SG_A, "aws.securitygroup", { groupId: "sg-aaa" }),
      node(SG_B, "aws.securitygroup", { groupId: "sg-bbb" }),
    ],
    [
      {
        subjectUrn: SG_B,
        kind: "aws.sg.rules",
        data: {
          ingress: overrides?.ingress ?? [{ fromPort: 5432, toPort: 5432, groupRefs: ["sg-aaa"] }],
        },
      },
    ],
    [protects(SG_A, EC2), protects(SG_B, RDS)],
  );
}

describe("R2 sg_correlation_connects", () => {
  it("EC2 whose SG is allowed into the DB's SG on the engine port ⇒ CONNECTS_TO (high)", () => {
    const out = sgCorrelationConnectsRule.evaluate(reachable());
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({
      type: "CONNECTS_TO",
      fromUrn: EC2,
      toUrn: RDS,
      tier: "inferred-high",
    });
    expect(out.edges[0]?.evidence).toMatchObject({ via: "sg", port: 5432, sourceSg: "sg-aaa" });
  });

  it("ingress on the wrong port ⇒ no edge (SG allows ≠ reaches the engine)", () => {
    const out = sgCorrelationConnectsRule.evaluate(
      reachable({ ingress: [{ fromPort: 443, toPort: 443, groupRefs: ["sg-aaa"] }] }),
    );
    expect(out.edges).toEqual([]);
  });

  it("different VPCs ⇒ no edge (no reachability across VPCs, P3)", () => {
    const out = sgCorrelationConnectsRule.evaluate(reachable({ ec2Vpc: "vpc-2" }));
    expect(out.edges).toEqual([]);
  });

  it("all-ports rule (protocol -1, no port range) covers the engine port", () => {
    const out = sgCorrelationConnectsRule.evaluate(
      reachable({ ingress: [{ groupRefs: ["sg-aaa"] }] }),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]?.toUrn).toBe(RDS);
  });

  it("uses the explicit endpointPort over the engine default", () => {
    const out = sgCorrelationConnectsRule.evaluate(
      reachable({
        rdsAttrs: { engine: "postgres", endpointPort: 6000, vpcId: "vpc-1" },
        ingress: [{ fromPort: 6000, toPort: 6000, groupRefs: ["sg-aaa"] }],
      }),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]?.evidence).toMatchObject({ port: 6000 });
  });

  it("no RDS in the estate ⇒ short-circuits to no edges", () => {
    const out = sgCorrelationConnectsRule.evaluate(makeInput([], []));
    expect(out.edges).toEqual([]);
  });
});
