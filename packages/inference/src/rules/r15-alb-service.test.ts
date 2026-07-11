import { describe, expect, it } from "vitest";
import { albRoutesToServiceRule } from "./r15-alb-service";
import type { InferenceInput, NodeLite, SignalLite } from "../types";

function buildInput(nodes: NodeLite[], signals: SignalLite[]): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of nodes) {
    nodesByUrn.set(n.urn, n);
    const l = nodesByKind.get(n.kind);
    if (l) l.push(n);
    else nodesByKind.set(n.kind, [n]);
  }
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
    observedEdges: [],
    inferredEdges: [],
  };
}

const TG = "arn:aws:elasticloadbalancing:us-east-1:111:targetgroup/tg-api/abc";
const elbUrn = "aws:us-east-1:111:elb:prod-alb";
const svcUrn = "aws:us-east-1:111:ecs-service:prod/api";

describe("R15 alb_routes_to_service", () => {
  it("links an ALB to an ECS service that share a target-group ARN → ROUTES_TO (inferred-high)", () => {
    const input = buildInput(
      [{ id: "elb", urn: elbUrn, kind: "aws.elb", attributes: { scheme: "internet-facing" } }],
      [
        { kind: "aws.elb.targetgroups", subjectUrn: elbUrn, data: { targetGroupArns: [TG] } },
        { kind: "aws.ecs.targetgroups", subjectUrn: svcUrn, data: { targetGroupArns: [TG] } },
      ],
    );
    const edges = albRoutesToServiceRule.evaluate(input).edges;
    expect(edges).toEqual([
      {
        type: "ROUTES_TO",
        fromUrn: elbUrn,
        toUrn: svcUrn,
        tier: "inferred-high",
        evidence: { via: "target-group", targetGroupArn: TG },
      },
    ]);
  });

  it("no shared target group → no edge", () => {
    const input = buildInput(
      [],
      [
        { kind: "aws.elb.targetgroups", subjectUrn: elbUrn, data: { targetGroupArns: [TG] } },
        {
          kind: "aws.ecs.targetgroups",
          subjectUrn: svcUrn,
          data: { targetGroupArns: ["arn:.../tg-other/xyz"] },
        },
      ],
    );
    expect(albRoutesToServiceRule.evaluate(input).edges).toHaveLength(0);
  });

  it("no ELB or no ECS signal → no edges", () => {
    expect(albRoutesToServiceRule.evaluate(buildInput([], [])).edges).toHaveLength(0);
  });
});
