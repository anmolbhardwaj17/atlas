import { describe, expect, it } from "vitest";
import { tagCodeCorrelationRule, repoSegment } from "./r11-tags";
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
const lambda = (name: string, tags: Record<string, string>): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:111122223333:lambda:${name}`,
  kind: "aws.lambda.function",
  attributes: { functionName: name, tags },
});
const ecsSvc = (name: string, tags: Record<string, string>): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:111122223333:ecs-service:default/${name}`,
  kind: "aws.ecs.service",
  attributes: { serviceName: name, tags },
});
const rds = (name: string, tags: Record<string, string>): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:111122223333:rds:${name}`,
  kind: "aws.rds.instance",
  attributes: { dbInstanceIdentifier: name, tags },
});

describe("R11 tag_code_correlation", () => {
  it("repoSegment extracts the repo name from a path/URL and strips .git", () => {
    expect(repoSegment("payments")).toBe("payments");
    expect(repoSegment("bitbucket.org/siemba/orders-api.git")).toBe("orders-api");
    expect(repoSegment("git@github.com:siemba/billing.git")).toBe("billing");
  });

  it("an explicit `repository` tag on a Lambda → DEPLOYS_TO the repo (inferred-high)", () => {
    const input = buildInput([repo("payments"), lambda("pay-fn", { repository: "payments" })]);
    const edges = tagCodeCorrelationRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "DEPLOYS_TO",
      fromUrn: "bitbucket:siemba:repository/payments",
      toUrn: "aws:us-east-1:111122223333:lambda:pay-fn",
      tier: "inferred-high",
      evidence: { rule: "tag-code", tagKey: "repository", matchedRepoSlug: "payments" },
    });
  });

  it("a `Service` tag (mixed case key) on an ECS service matches by exact normalized slug", () => {
    const input = buildInput([
      repo("orders-api"),
      ecsSvc("orders", { Service: "orders-api", env: "prod" }),
    ]);
    const edges = tagCodeCorrelationRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      tier: "inferred-high",
      fromUrn: expect.stringContaining("orders-api"),
    });
  });

  it("a CloudFormation stack-name tag matches after env-suffix stripping", () => {
    const input = buildInput([
      repo("billing"),
      lambda("billing-fn", { "aws:cloudformation:stack-name": "billing-prod" }),
    ]);
    const edges = tagCodeCorrelationRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      tier: "inferred-high",
      fromUrn: expect.stringContaining("billing"),
    });
  });

  it("a repo-path tag value resolves to the last segment", () => {
    const input = buildInput([
      repo("orders-api"),
      lambda("o-fn", { repository: "bitbucket.org/siemba/orders-api" }),
    ]);
    expect(tagCodeCorrelationRule.evaluate(input).edges).toHaveLength(1);
  });

  it("a generic tag value proves nothing → no edge (P3)", () => {
    const input = buildInput([repo("core"), lambda("fn", { application: "core" })]);
    expect(tagCodeCorrelationRule.evaluate(input).edges).toHaveLength(0);
  });

  it("an unrecognized tag key is ignored", () => {
    const input = buildInput([repo("payments"), lambda("fn", { environment: "payments" })]);
    expect(tagCodeCorrelationRule.evaluate(input).edges).toHaveLength(0);
  });

  it("a value matching several repos → inferred-low each, never one wrong high (P3)", () => {
    // Both slugs normalize to "orders" (env suffix stripped) → ambiguous.
    const input = buildInput([
      repo("orders"),
      repo("orders-dev"),
      lambda("fn", { repository: "orders" }),
    ]);
    const edges = tagCodeCorrelationRule.evaluate(input).edges;
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.tier === "inferred-low")).toBe(true);
  });

  it("a code tag on a DATASTORE is not a deploy target → no edge", () => {
    const input = buildInput([repo("payments"), rds("payments-db", { repository: "payments" })]);
    expect(tagCodeCorrelationRule.evaluate(input).edges).toHaveLength(0);
  });

  it("no repos → no edges (nothing to match against)", () => {
    const input = buildInput([lambda("fn", { repository: "payments" })]);
    expect(tagCodeCorrelationRule.evaluate(input).edges).toHaveLength(0);
  });
});
