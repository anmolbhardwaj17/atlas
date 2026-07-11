import { describe, expect, it } from "vitest";
import { lambdaCommitProvenanceRule, shasFromText } from "./r17-lambda-commit";
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
const lambda = (name: string, attributes: Record<string, unknown>): NodeLite => ({
  id: name,
  urn: `aws:us-east-1:${ACCT}:lambda:${name}`,
  kind: "aws.lambda.function",
  attributes: { functionName: name, ...attributes },
});
const img = (repoName: string, tag: string): string =>
  `${ACCT}.dkr.ecr.us-east-1.amazonaws.com/${repoName}:${tag}`;

const FULL_SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const SHORT = FULL_SHA.slice(0, 7);

describe("R17 lambda_commit_provenance", () => {
  it("shasFromText extracts git SHAs from free text, ignoring numbers and short tokens", () => {
    expect(shasFromText("deployed from a1b2c3d today")).toContain("a1b2c3d");
    expect(shasFromText("GIT_SHA=a1b2c3d4e5")).toContain("a1b2c3d4e5");
    expect(shasFromText("build 20240115")).toEqual([]); // pure numeric → not a SHA
    expect(shasFromText("v1.2.3 release")).toEqual([]); // too short / no hex run
  });

  it("a git SHA in the function Description matching a PR commit → repo DEPLOYS_TO the Lambda (high)", () => {
    const input = buildInput([
      repo("chat"),
      pr("chat", [FULL_SHA]),
      lambda("calsaws-chat-SendMessage", { description: `Deployed from ${SHORT}` }),
    ]);
    const edges = lambdaCommitProvenanceRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "DEPLOYS_TO",
      fromUrn: "bitbucket:siemba:repository/chat",
      toUrn: `aws:us-east-1:${ACCT}:lambda:calsaws-chat-SendMessage`,
      tier: "inferred-high",
      evidence: { rule: "lambda-commit", match: "description-sha", matchedCommitSha: FULL_SHA },
    });
  });

  it("a git SHA in a container Lambda's image tag → high-confidence edge", () => {
    const input = buildInput([
      repo("chat"),
      pr("chat", [FULL_SHA]),
      lambda("chat-fn", { packageType: "Image", imageUri: img("chat", `main-${SHORT}`) }),
    ]);
    const edges = lambdaCommitProvenanceRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ tier: "inferred-high", evidence: { match: "image-tag-sha" } });
  });

  it("a git SHA in a tag value matches", () => {
    const input = buildInput([
      repo("chat"),
      pr("chat", [FULL_SHA]),
      lambda("chat-fn", { tags: { GIT_SHA: SHORT, env: "prod" } }),
    ]);
    const edges = lambdaCommitProvenanceRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ tier: "inferred-high", evidence: { match: "tag-sha" } });
  });

  it("CodeSha256 is NOT treated as a git SHA (it's a zip hash) — no fabricated edge", () => {
    const input = buildInput([
      repo("chat"),
      pr("chat", [FULL_SHA]),
      // codeSha256 present but NOT a commit; description/imageUri/tags carry no SHA → nothing.
      lambda("chat-fn", {
        codeSha256: "hZ8k2f+base64hashnotacommit=",
        description: "prod handler",
      }),
    ]);
    expect(lambdaCommitProvenanceRule.evaluate(input).edges).toHaveLength(0);
  });

  it("a SHA matching PRs in two repos → inferred-low each (P3, never one wrong high)", () => {
    const input = buildInput([
      repo("chat"),
      repo("chat-fork"),
      pr("chat", [FULL_SHA]),
      pr("chat-fork", [FULL_SHA]),
      lambda("chat-fn", { description: `built ${SHORT}` }),
    ]);
    const edges = lambdaCommitProvenanceRule.evaluate(input).edges;
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.tier === "inferred-low")).toBe(true);
  });

  it("no SHA anywhere on the function → no edges", () => {
    const input = buildInput([
      repo("chat"),
      pr("chat", [FULL_SHA]),
      lambda("chat-fn", { description: "prod handler", tags: { env: "prod" } }),
    ]);
    expect(lambdaCommitProvenanceRule.evaluate(input).edges).toHaveLength(0);
  });
});
