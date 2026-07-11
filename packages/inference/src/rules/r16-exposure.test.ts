import { describe, expect, it } from "vitest";
import { internetExposureRule } from "./r16-exposure";
import type { EdgeLite, InferenceInput, NodeLite, SignalLite } from "../types";

function buildInput(opts: {
  nodes: NodeLite[];
  signals?: SignalLite[];
  observedEdges?: EdgeLite[];
  inferredEdges?: EdgeLite[];
}): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of opts.nodes) {
    nodesByUrn.set(n.urn, n);
    const l = nodesByKind.get(n.kind);
    if (l) l.push(n);
    else nodesByKind.set(n.kind, [n]);
  }
  const signals = opts.signals ?? [];
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of signals) {
    const l = signalsByKind.get(s.kind);
    if (l) l.push(s);
    else signalsByKind.set(s.kind, [s]);
  }
  return {
    orgSlug: "siemba",
    nodesByUrn,
    nodesByKind,
    signals,
    signalsByKind,
    observedEdges: opts.observedEdges ?? [],
    inferredEdges: opts.inferredEdges ?? [],
  };
}

const sgUrn = "aws:us-east-1:111:sg:sg-web";
const ec2Urn = "aws:us-east-1:111:ec2:i-1";
const svcUrn = "aws:us-east-1:111:ecs-service:prod/api";
const elbUrn = "aws:us-east-1:111:elb:prod-alb";
const ec2 = (urn: string): NodeLite => ({ id: urn, urn, kind: "aws.ec2.instance", attributes: {} });
const svc = (urn: string): NodeLite => ({ id: urn, urn, kind: "aws.ecs.service", attributes: {} });

describe("R16 internet_exposure", () => {
  it("a world-open SG protecting an EC2 instance → EXPOSED_VIA(ec2→sg) with the open port", () => {
    const input = buildInput({
      nodes: [ec2(ec2Urn)],
      signals: [
        {
          kind: "aws.sg.rules",
          subjectUrn: sgUrn,
          data: { ingress: [{ fromPort: 22, toPort: 22, cidrs: ["0.0.0.0/0"] }] },
        },
      ],
      observedEdges: [{ type: "PROTECTS", fromUrn: sgUrn, toUrn: ec2Urn }],
    });
    expect(internetExposureRule.evaluate(input).edges).toEqual([
      {
        type: "EXPOSED_VIA",
        fromUrn: ec2Urn,
        toUrn: sgUrn,
        tier: "inferred-high",
        evidence: { via: "world-open-sg", ports: "22" },
      },
    ]);
  });

  it("an internet-facing LB routing to an ECS service (R15 inferred) → EXPOSED_VIA(service→elb)", () => {
    const input = buildInput({
      nodes: [
        svc(svcUrn),
        { id: elbUrn, urn: elbUrn, kind: "aws.elb", attributes: { scheme: "internet-facing" } },
      ],
      inferredEdges: [{ type: "ROUTES_TO", fromUrn: elbUrn, toUrn: svcUrn, tier: "inferred-high" }],
    });
    expect(internetExposureRule.evaluate(input).edges).toEqual([
      {
        type: "EXPOSED_VIA",
        fromUrn: svcUrn,
        toUrn: elbUrn,
        tier: "inferred-high",
        evidence: { via: "internet-facing-lb" },
      },
    ]);
  });

  it("an INTERNAL load balancer is not exposure (P3 — no edge)", () => {
    const input = buildInput({
      nodes: [
        svc(svcUrn),
        { id: elbUrn, urn: elbUrn, kind: "aws.elb", attributes: { scheme: "internal" } },
      ],
      inferredEdges: [{ type: "ROUTES_TO", fromUrn: elbUrn, toUrn: svcUrn, tier: "inferred-high" }],
    });
    expect(internetExposureRule.evaluate(input).edges).toHaveLength(0);
  });

  it("a world-open SG protecting a NON-compute resource (RDS) is ignored (only compute is exposed here)", () => {
    const rdsUrn = "aws:us-east-1:111:rds:db";
    const input = buildInput({
      nodes: [{ id: rdsUrn, urn: rdsUrn, kind: "aws.rds.instance", attributes: {} }],
      signals: [
        {
          kind: "aws.sg.rules",
          subjectUrn: sgUrn,
          data: { ingress: [{ fromPort: 5432, toPort: 5432, cidrs: ["0.0.0.0/0"] }] },
        },
      ],
      observedEdges: [{ type: "PROTECTS", fromUrn: sgUrn, toUrn: rdsUrn }],
    });
    expect(internetExposureRule.evaluate(input).edges).toHaveLength(0);
  });

  it("a SG with only scoped ingress (no 0.0.0.0/0) → no exposure", () => {
    const input = buildInput({
      nodes: [ec2(ec2Urn)],
      signals: [
        {
          kind: "aws.sg.rules",
          subjectUrn: sgUrn,
          data: { ingress: [{ fromPort: 22, toPort: 22, cidrs: ["10.0.0.0/8"] }] },
        },
      ],
      observedEdges: [{ type: "PROTECTS", fromUrn: sgUrn, toUrn: ec2Urn }],
    });
    expect(internetExposureRule.evaluate(input).edges).toHaveLength(0);
  });
});
