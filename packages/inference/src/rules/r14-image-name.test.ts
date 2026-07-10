import { describe, expect, it } from "vitest";
import { imageNameCorrelationRule, imageName } from "./r14-image-name";
import type { InferenceInput, NodeLite } from "../types";

function buildInput(nodes: NodeLite[]): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of nodes) {
    nodesByUrn.set(n.urn, n);
    const l = nodesByKind.get(n.kind);
    if (l) l.push(n);
    else nodesByKind.set(n.kind, [n]);
  }
  return {
    orgSlug: "siemba",
    nodesByUrn,
    nodesByKind,
    signals: [],
    signalsByKind: new Map(),
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
const service = (name: string, family: string): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:111:ecs-service:prod/${name}`,
  kind: "aws.ecs.service",
  attributes: {
    serviceName: name,
    taskDefinition: `arn:aws:ecs:us-east-1:111:task-definition/${family}:4`,
  },
});
const taskdef = (family: string, images: string[]): NodeLite => ({
  id: family,
  urn: `aws:us-east-1:111:ecs-taskdef:${family}`,
  kind: "aws.ecs.taskdef",
  attributes: { family, images },
});

describe("R14 image_name_correlation", () => {
  it("imageName extracts the repo segment before the tag/digest", () => {
    expect(imageName("123.dkr.ecr.us-east-1.amazonaws.com/api-backend:latest")).toBe("api-backend");
    expect(imageName("123.dkr.ecr.us-east-1.amazonaws.com/team/integration-prod:latest")).toBe(
      "integration-prod",
    );
    expect(imageName("nginx@sha256:abc")).toBe("nginx");
  });

  it("an ECR image name matching a repo (stem) → DEPLOYS_TO the ECS service (inferred-high)", () => {
    const input = buildInput([
      repo("api-backend-provapt"),
      service("calsaws-backend-api-service", "calsaws-backend-api-df"),
      taskdef("calsaws-backend-api-df", [
        "851725189424.dkr.ecr.us-east-1.amazonaws.com/api-backend:latest",
      ]),
    ]);
    const edges = imageNameCorrelationRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "DEPLOYS_TO",
      fromUrn: "bitbucket:siemba:repository/api-backend-provapt",
      toUrn: "aws:us-east-1:111:ecs-service:prod/calsaws-backend-api-service",
      tier: "inferred-high",
      evidence: { rule: "image-name", match: "ecr-image-name" },
    });
  });

  it("env-suffixed image name matches after normalization (integration-prod ~ integrations)", () => {
    const input = buildInput([
      repo("integrations"),
      service("calsaws-integration-service", "calsaws-integration-df"),
      taskdef("calsaws-integration-df", [
        "851725189424.dkr.ecr.us-east-1.amazonaws.com/integration-prod:latest",
      ]),
    ]);
    expect(imageNameCorrelationRule.evaluate(input).edges).toHaveLength(1);
  });

  it("a generic image name (app/web) proves nothing → no edge (P3)", () => {
    const input = buildInput([
      repo("web"),
      service("svc", "fam"),
      taskdef("fam", ["123.dkr.ecr.us-east-1.amazonaws.com/web:latest"]),
    ]);
    expect(imageNameCorrelationRule.evaluate(input).edges).toHaveLength(0);
  });

  it("an image name matching several repos → inferred-low each, never one wrong high (P3)", () => {
    const input = buildInput([
      repo("payments"),
      repo("payments-dev"), // both normalize to "payments"
      service("svc", "fam"),
      taskdef("fam", ["123.dkr.ecr.us-east-1.amazonaws.com/payments:latest"]),
    ]);
    const edges = imageNameCorrelationRule.evaluate(input).edges;
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.tier === "inferred-low")).toBe(true);
  });

  it("no ECS service / no taskdef / no repos → no edges", () => {
    expect(imageNameCorrelationRule.evaluate(buildInput([repo("x")])).edges).toHaveLength(0);
  });
});
