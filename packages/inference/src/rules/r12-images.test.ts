import { describe, expect, it } from "vitest";
import { imageCommitProvenanceRule, shasFromImage } from "./r12-images";
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

const ACCT = "111122223333";
const repo = (slug: string): NodeLite => ({
  id: slug,
  urn: `bitbucket:siemba:repository/${slug}`,
  kind: "bitbucket.repository",
  attributes: { slug },
});
const pr = (slug: string, shas: string[]): NodeLite => ({
  id: `${slug}-pr`,
  urn: `bitbucket:siemba:repository/${slug}/pr/1`,
  kind: "bitbucket.pullrequest",
  attributes: { repoSlug: slug, commitShas: shas },
});
const taskdef = (family: string, images: string[]): NodeLite => ({
  id: family,
  urn: `aws:us-east-1:${ACCT}:ecs-taskdef:${family}`,
  kind: "aws.ecs.taskdef",
  attributes: { family, images },
});
const service = (name: string, family: string): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:${ACCT}:ecs-service:prod/${name}`,
  kind: "aws.ecs.service",
  attributes: {
    serviceName: name,
    taskDefinition: `arn:aws:ecs:us-east-1:${ACCT}:task-definition/${family}:7`,
  },
});
const img = (repoName: string, tag: string): string =>
  `${ACCT}.dkr.ecr.us-east-1.amazonaws.com/${repoName}:${tag}`;

const FULL_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

describe("R12 image_commit_provenance", () => {
  it("shasFromImage extracts a git short-SHA from the tag, ignoring digests and non-SHA tags", () => {
    expect(shasFromImage(img("pay", "main-a1b2c3d"))).toContain("a1b2c3d");
    expect(shasFromImage(img("pay", "sha-a1b2c3d4e5"))).toContain("a1b2c3d4e5");
    expect(shasFromImage(img("pay", "latest"))).toEqual([]);
    expect(shasFromImage(img("pay", "v1.2.3"))).toEqual([]);
    // pure-numeric build date is not a SHA (no a-f letter)
    expect(shasFromImage(img("pay", "20240115"))).toEqual([]);
    // docker digest is stripped, no git SHA in the tag
    expect(shasFromImage(`${ACCT}.dkr.ecr.us-east-1.amazonaws.com/pay@sha256:${FULL_SHA}`)).toEqual(
      [],
    );
  });

  it("an image tag SHA matching a PR commit → repo DEPLOYS_TO the ECS service (inferred-high)", () => {
    const input = buildInput([
      repo("payments"),
      pr("payments", [FULL_SHA]),
      taskdef("pay-td", [img("payments", `main-${FULL_SHA.slice(0, 7)}`)]),
      service("pay-svc", "pay-td"),
    ]);
    const edges = imageCommitProvenanceRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "DEPLOYS_TO",
      fromUrn: "bitbucket:siemba:repository/payments",
      toUrn: `aws:us-east-1:${ACCT}:ecs-service:prod/pay-svc`,
      tier: "inferred-high",
      evidence: {
        rule: "image-commit",
        imageSha: FULL_SHA.slice(0, 7),
        matchedCommitSha: FULL_SHA,
      },
    });
  });

  it("a tag with no SHA-shaped token yields nothing (P3)", () => {
    const input = buildInput([
      repo("payments"),
      pr("payments", [FULL_SHA]),
      taskdef("pay-td", [img("payments", "latest")]),
      service("pay-svc", "pay-td"),
    ]);
    expect(imageCommitProvenanceRule.evaluate(input).edges).toHaveLength(0);
  });

  it("an image SHA that matches no crawled commit yields nothing", () => {
    const input = buildInput([
      repo("payments"),
      pr("payments", [FULL_SHA]),
      taskdef("pay-td", [img("payments", "main-deadbee")]),
      service("pay-svc", "pay-td"),
    ]);
    expect(imageCommitProvenanceRule.evaluate(input).edges).toHaveLength(0);
  });

  it("a SHA matching PRs in two repos → inferred-low each (P3, never one wrong high)", () => {
    const input = buildInput([
      repo("payments"),
      repo("payments-fork"),
      pr("payments", [FULL_SHA]),
      pr("payments-fork", [FULL_SHA]),
      taskdef("pay-td", [img("payments", `build-${FULL_SHA.slice(0, 10)}`)]),
      service("pay-svc", "pay-td"),
    ]);
    const edges = imageCommitProvenanceRule.evaluate(input).edges;
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.tier === "inferred-low")).toBe(true);
  });

  it("no PRs with commit SHAs → no edges", () => {
    const input = buildInput([
      repo("payments"),
      taskdef("pay-td", [img("payments", `main-${FULL_SHA.slice(0, 7)}`)]),
      service("pay-svc", "pay-td"),
    ]);
    expect(imageCommitProvenanceRule.evaluate(input).edges).toHaveLength(0);
  });
});
