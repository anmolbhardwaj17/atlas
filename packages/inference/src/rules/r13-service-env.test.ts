import { describe, expect, it } from "vitest";
import { serviceNameEnvRule, serviceNameValues } from "./r13-service-env";
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

const ACCT = "111122223333";
const repo = (slug: string): NodeLite => ({
  id: slug,
  urn: `bitbucket:siemba:repository/${slug}`,
  kind: "bitbucket.repository",
  attributes: { slug },
});
const lambda = (name: string): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:${ACCT}:lambda:${name}`,
  kind: "aws.lambda.function",
  attributes: { functionName: name },
});
const taskdef = (family: string): NodeLite => ({
  id: family,
  urn: `aws:us-east-1:${ACCT}:ecs-taskdef:${family}`,
  kind: "aws.ecs.taskdef",
  attributes: { family },
});
const service = (name: string, family: string): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:${ACCT}:ecs-service:prod/${name}`,
  kind: "aws.ecs.service",
  attributes: {
    serviceName: name,
    taskDefinition: `arn:aws:ecs:us-east-1:${ACCT}:task-definition/${family}:3`,
  },
});
const lambdaEnv = (fnUrn: string, variables: Record<string, string>): SignalLite => ({
  subjectUrn: fnUrn,
  kind: "aws.lambda.env",
  data: { variables },
});
const ecsEnv = (tdUrn: string, variables: Record<string, string>): SignalLite => ({
  subjectUrn: tdUrn,
  kind: "aws.ecs.env",
  data: { variables },
});

describe("R13 service_name_env_correlation", () => {
  it("serviceNameValues reads known keys and OTEL resource attributes", () => {
    expect(serviceNameValues({ DD_SERVICE: "payments" })).toEqual([
      { key: "DD_SERVICE", name: "payments" },
    ]);
    expect(
      serviceNameValues({
        OTEL_RESOURCE_ATTRIBUTES: "deployment.env=prod,service.name=orders-api",
      }),
    ).toEqual([{ key: "OTEL_RESOURCE_ATTRIBUTES", name: "orders-api" }]);
    expect(serviceNameValues({ UNRELATED: "x" })).toEqual([]);
  });

  it("OTEL_SERVICE_NAME on a Lambda → repo DEPLOYS_TO the Lambda (inferred-high)", () => {
    const fn = lambda("pay-fn");
    const input = buildInput(
      [repo("payments"), fn],
      [lambdaEnv(fn.urn, { OTEL_SERVICE_NAME: "payments" })],
    );
    const edges = serviceNameEnvRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "DEPLOYS_TO",
      fromUrn: "bitbucket:siemba:repository/payments",
      toUrn: fn.urn,
      tier: "inferred-high",
      evidence: { rule: "service-env", envKey: "OTEL_SERVICE_NAME", matchedRepoSlug: "payments" },
    });
  });

  it("a task-def DD_SERVICE resolves to the ECS service running that family", () => {
    const td = taskdef("orders-td");
    const svc = service("orders-svc", "orders-td");
    const input = buildInput(
      [repo("orders-api"), td, svc],
      [ecsEnv(td.urn, { DD_SERVICE: "orders-api" })],
    );
    const edges = serviceNameEnvRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ toUrn: svc.urn, tier: "inferred-high" });
  });

  it("a generic service name proves nothing → no edge (P3)", () => {
    const fn = lambda("fn");
    const input = buildInput([repo("core"), fn], [lambdaEnv(fn.urn, { SERVICE_NAME: "core" })]);
    expect(serviceNameEnvRule.evaluate(input).edges).toHaveLength(0);
  });

  it("a name matching two repos → inferred-low each (P3)", () => {
    const fn = lambda("fn");
    const input = buildInput(
      [repo("orders"), repo("orders-dev"), fn],
      [lambdaEnv(fn.urn, { DD_SERVICE: "orders" })],
    );
    const edges = serviceNameEnvRule.evaluate(input).edges;
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.tier === "inferred-low")).toBe(true);
  });

  it("no matching repo → no edge", () => {
    const fn = lambda("fn");
    const input = buildInput(
      [repo("payments"), fn],
      [lambdaEnv(fn.urn, { DD_SERVICE: "billing" })],
    );
    expect(serviceNameEnvRule.evaluate(input).edges).toHaveLength(0);
  });
});
