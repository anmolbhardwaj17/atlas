import { describe, it, expect } from "vitest";
import { repoDeploysToRuntimeRule } from "./r1-deploys";
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
  return { nodesByUrn, nodesByKind, signals, signalsByKind, observedEdges: [] };
}

const ecs = (urn: string, serviceName: string, cluster: string): NodeLite => ({
  id: urn,
  urn,
  kind: "aws.ecs.service",
  attributes: { serviceName, cluster },
});
const lambda = (urn: string, functionName: string): NodeLite => ({
  id: urn,
  urn,
  kind: "aws.lambda.function",
  attributes: { functionName },
});
const deploySignal = (repo: string, targets: unknown[]): SignalLite => ({
  subjectUrn: "github:acme/orders:workflow:.github/workflows/deploy.yml",
  kind: "github.workflow.deploy",
  data: { repo, targets },
});

const ORDERS_ECS = "aws:us-east-1:123456789012:ecs-service:prod/orders";
const REPO = "github:acme/orders";

describe("R1 repo_deploys_to_runtime", () => {
  it("exact ARN target → inferred-high DEPLOYS_TO(repo→service)", () => {
    const input = buildInput(
      [ecs(ORDERS_ECS, "orders", "prod")],
      [
        deploySignal(REPO, [
          { kind: "arn", arn: "arn:aws:ecs:us-east-1:123456789012:service/prod/orders" },
        ]),
      ],
    );
    const edges = repoDeploysToRuntimeRule.evaluate(input);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "DEPLOYS_TO",
      fromUrn: REPO,
      toUrn: ORDERS_ECS,
      tier: "inferred-high",
    });
    expect((edges[0]?.evidence as { match: string }).match).toBe("arn");
  });

  it("unique cluster/service name → inferred-high", () => {
    const input = buildInput(
      [ecs(ORDERS_ECS, "orders", "prod")],
      [deploySignal(REPO, [{ kind: "ecs", cluster: "prod", service: "orders" }])],
    );
    expect(repoDeploysToRuntimeRule.evaluate(input)[0]).toMatchObject({
      toUrn: ORDERS_ECS,
      tier: "inferred-high",
    });
  });

  it("ambiguous name (two candidates) → two inferred-low edges, never one wrong high (P3)", () => {
    const a = ecs("aws:us-east-1:123456789012:ecs-service:prod/orders", "orders", "prod");
    const b = ecs("aws:eu-west-1:123456789012:ecs-service:staging/orders", "orders", "staging");
    const input = buildInput(
      [a, b],
      [deploySignal(REPO, [{ kind: "ecs", cluster: null, service: "orders" }])],
    );
    const edges = repoDeploysToRuntimeRule.evaluate(input);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.tier === "inferred-low")).toBe(true);
    expect(edges.map((e) => e.toUrn).sort()).toEqual([a.urn, b.urn].sort());
  });

  it("lambda name → high; unresolvable target → nothing", () => {
    const fn = lambda("aws:us-east-1:123456789012:lambda:resize", "resize");
    const hit = buildInput([fn], [deploySignal(REPO, [{ kind: "lambda", function: "resize" }])]);
    expect(repoDeploysToRuntimeRule.evaluate(hit)[0]).toMatchObject({
      toUrn: fn.urn,
      tier: "inferred-high",
    });

    const miss = buildInput([fn], [deploySignal(REPO, [{ kind: "lambda", function: "ghost" }])]);
    expect(repoDeploysToRuntimeRule.evaluate(miss)).toEqual([]);
  });
});
