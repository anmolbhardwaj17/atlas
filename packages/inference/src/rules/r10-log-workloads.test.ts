import { describe, expect, it } from "vitest";
import { logWorkloadCorrelationRule, normalizeWorkload } from "./r10-log-workloads";
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
    orgSlug: "acme",
    nodesByUrn,
    nodesByKind,
    signals,
    signalsByKind,
    observedEdges: [],
    inferredEdges: [],
  };
}

const repo = (slug: string): NodeLite => ({
  id: slug,
  urn: `bitbucket:siemba:repository/${slug}`,
  kind: "bitbucket.repository",
  attributes: { slug },
});
const ec2 = (id: string): NodeLite => ({
  id,
  urn: `aws:us-east-1:851725189424:ec2:${id}`,
  kind: "aws.ec2.instance",
  attributes: { instanceId: id },
});
const lambda = (name: string): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:851725189424:lambda:${name}`,
  kind: "aws.lambda.function",
  attributes: { functionName: name },
});
const wl = (logGroup: string, name: string, host: string): SignalLite => ({
  subjectUrn: `aws:us-east-1:851725189424:logs:${logGroup}`,
  kind: "aws.logs.workload",
  data: { logGroup, name, host, account: "851725189424", region: "us-east-1" },
});

describe("R10 log_workload_correlation", () => {
  it("normalizes env suffixes and separators", () => {
    expect(normalizeWorkload("Chat-API-production")).toBe("chatapi");
    expect(normalizeWorkload("provapt_reports.demo")).toBe("provaptreports");
  });

  it("custom log group name matches a repo → DEPLOYS_TO the single EC2 instance (inferred-low)", () => {
    const input = buildInput(
      [repo("chat-api"), ec2("i-abc")],
      [wl("/var/log/chat-api-production", "chat-api-production", "ec2")],
    );
    const edges = logWorkloadCorrelationRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "DEPLOYS_TO",
      fromUrn: "bitbucket:siemba:repository/chat-api",
      toUrn: "aws:us-east-1:851725189424:ec2:i-abc",
      tier: "inferred-low",
    });
    expect((edges[0]?.evidence as { logGroup: string }).logGroup).toBe(
      "/var/log/chat-api-production",
    );
  });

  it("lambda log group with a unique function → inferred-high to that function", () => {
    const input = buildInput(
      [repo("chat-functions"), lambda("chat-functions-send")],
      [wl("/aws/lambda/chat-functions-send", "chat-functions-send", "lambda")],
    );
    const edges = logWorkloadCorrelationRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]?.tier).toBe("inferred-high");
  });

  it("many EC2 instances (above cap) → no edges; never a wrong guess (P3)", () => {
    const input = buildInput(
      [repo("chat-api"), ec2("i-1"), ec2("i-2"), ec2("i-3"), ec2("i-4")],
      [wl("chat-api", "chat-api", "unknown")],
    );
    expect(logWorkloadCorrelationRule.evaluate(input).edges).toEqual([]);
  });

  it("short/generic tokens never match ('api' can't glue the estate together)", () => {
    const input = buildInput([repo("api"), ec2("i-1")], [wl("api", "api", "unknown")]);
    expect(logWorkloadCorrelationRule.evaluate(input).edges).toEqual([]);
  });
});
