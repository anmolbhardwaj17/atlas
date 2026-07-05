import { describe, it, expect } from "vitest";
import { repoDeploysToRuntimeRule } from "./r1-deploys";
import type { InferenceInput, NodeLite, SignalLite } from "../types";

function buildInput(
  nodes: NodeLite[],
  signals: SignalLite[],
  observedEdges: InferenceInput["observedEdges"] = [],
): InferenceInput {
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
    observedEdges,
    inferredEdges: [],
  };
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
    const edges = repoDeploysToRuntimeRule.evaluate(input).edges;
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
    expect(repoDeploysToRuntimeRule.evaluate(input).edges[0]).toMatchObject({
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
    const edges = repoDeploysToRuntimeRule.evaluate(input).edges;
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.tier === "inferred-low")).toBe(true);
    expect(edges.map((e) => e.toUrn).sort()).toEqual([a.urn, b.urn].sort());
  });

  it("lambda name → high; unresolvable target → nothing", () => {
    const fn = lambda("aws:us-east-1:123456789012:lambda:resize", "resize");
    const hit = buildInput([fn], [deploySignal(REPO, [{ kind: "lambda", function: "resize" }])]);
    expect(repoDeploysToRuntimeRule.evaluate(hit).edges[0]).toMatchObject({
      toUrn: fn.urn,
      tier: "inferred-high",
    });

    const miss = buildInput([fn], [deploySignal(REPO, [{ kind: "lambda", function: "ghost" }])]);
    expect(repoDeploysToRuntimeRule.evaluate(miss).edges).toEqual([]);
  });
});

// ── v2: bitbucket.pipeline.deploy + the ECR image chain ──────────────────────────────

const BB_REPO = "bitbucket:siemba:repository/chat-api";
const ECR = "aws:us-east-1:851725189424:ecr:calsaws-chat";
const TASKDEF = "aws:us-east-1:851725189424:ecs-taskdef:chat";
const CHAT_ECS = "aws:us-east-1:851725189424:ecs-service:prod/chat";

const ecrNode = (urn: string): NodeLite => ({
  id: urn,
  urn,
  kind: "aws.ecr.repository",
  attributes: {},
});
const ecsWithTaskdef = (urn: string, name: string, family: string): NodeLite => ({
  id: urn,
  urn,
  kind: "aws.ecs.service",
  attributes: {
    serviceName: name,
    cluster: "prod",
    taskDefinition: `arn:aws:ecs:us-east-1:851725189424:task-definition/${family}:12`,
  },
});
const bbSignal = (data: Record<string, unknown>): SignalLite => ({
  subjectUrn: BB_REPO,
  kind: "bitbucket.pipeline.deploy",
  data: { repo: BB_REPO, ...data },
});
const IMAGE = { account: "851725189424", region: "us-east-1", repository: "calsaws-chat" };

describe("R1 v2 - bitbucket signals + ECR image chain", () => {
  it("ECR image → USES_IMAGE taskdef → unique ECS service ⇒ inferred-high with the chain cited", () => {
    const input = buildInput(
      [ecrNode(ECR), ecsWithTaskdef(CHAT_ECS, "chat", "chat")],
      [bbSignal({ ecrImages: [IMAGE] })],
      [{ type: "USES_IMAGE", fromUrn: TASKDEF, toUrn: ECR }],
    );
    const edges = repoDeploysToRuntimeRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "DEPLOYS_TO",
      fromUrn: BB_REPO,
      toUrn: CHAT_ECS,
      tier: "inferred-high",
    });
    const ev = edges[0]?.evidence as { match: string; chain: { ecrRepository: string } };
    expect(ev.match).toBe("ecr-image");
    expect(ev.chain.ecrRepository).toBe(ECR);
  });

  it("two services run the family ⇒ two inferred-low edges (P3)", () => {
    const a = ecsWithTaskdef(CHAT_ECS, "chat", "chat");
    const b = ecsWithTaskdef(
      "aws:us-east-1:851725189424:ecs-service:prod/chat-canary",
      "chat-canary",
      "chat",
    );
    const input = buildInput(
      [ecrNode(ECR), a, b],
      [bbSignal({ ecrImages: [IMAGE] })],
      [{ type: "USES_IMAGE", fromUrn: TASKDEF, toUrn: ECR }],
    );
    const edges = repoDeploysToRuntimeRule.evaluate(input).edges;
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.tier === "inferred-low")).toBe(true);
  });

  it("broken chain (no USES_IMAGE, or ECR repo not crawled) ⇒ nothing, never a guess", () => {
    const noEdge = buildInput(
      [ecrNode(ECR), ecsWithTaskdef(CHAT_ECS, "chat", "chat")],
      [bbSignal({ ecrImages: [IMAGE] })],
    );
    expect(repoDeploysToRuntimeRule.evaluate(noEdge).edges).toEqual([]);

    const noEcr = buildInput(
      [ecsWithTaskdef(CHAT_ECS, "chat", "chat")],
      [bbSignal({ ecrImages: [IMAGE] })],
      [{ type: "USES_IMAGE", fromUrn: TASKDEF, toUrn: ECR }],
    );
    expect(repoDeploysToRuntimeRule.evaluate(noEcr).edges).toEqual([]);
  });

  it("bitbucket ecs/lambda name targets resolve like github ones; image+name double witness dedupes to the high tier", () => {
    const input = buildInput(
      [ecrNode(ECR), ecsWithTaskdef(CHAT_ECS, "chat", "chat")],
      [
        bbSignal({
          targets: [{ kind: "ecs", cluster: "prod", service: "chat" }],
          ecrImages: [IMAGE],
        }),
      ],
      [{ type: "USES_IMAGE", fromUrn: TASKDEF, toUrn: ECR }],
    );
    const edges = repoDeploysToRuntimeRule.evaluate(input).edges;
    expect(edges).toHaveLength(1); // deduped, one edge repo→service
    expect(edges[0]?.tier).toBe("inferred-high");
  });
});
