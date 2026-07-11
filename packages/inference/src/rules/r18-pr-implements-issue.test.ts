import { describe, expect, it } from "vitest";
import { prImplementsIssueRule, keysFromPr } from "./r18-pr-implements-issue";
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
    orgSlug: "acme",
    nodesByUrn,
    nodesByKind,
    signals: [],
    signalsByKind: new Map(),
    observedEdges: [],
    inferredEdges: [],
  };
}

const issue = (key: string): NodeLite => ({
  id: key,
  urn: `jira:acme:issue/${key}`,
  kind: "jira.issue",
  attributes: { key },
});
const pr = (id: string, name: string, branch?: string): NodeLite => ({
  id,
  urn: `bitbucket:acme:pullrequest/repo/${id}`,
  kind: "bitbucket.pullrequest",
  name,
  attributes: branch ? { sourceBranch: branch } : {},
});

describe("R18 pr_implements_issue", () => {
  it("keysFromPr extracts Jira keys from the title and branch", () => {
    expect(keysFromPr(pr("1", "ENG-142: add verification", "feature/ops-9-x"))).toEqual(
      expect.arrayContaining(["ENG-142", "OPS-9"]),
    );
    expect(keysFromPr(pr("2", "no key here", "main"))).toEqual([]);
  });

  it("a Jira key in the PR title matching a crawled issue → IMPLEMENTS (inferred-high)", () => {
    const input = buildInput([issue("ENG-142"), pr("1", "ENG-142: add email verification")]);
    const edges = prImplementsIssueRule.evaluate(input).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      type: "IMPLEMENTS",
      fromUrn: "bitbucket:acme:pullrequest/repo/1",
      toUrn: "jira:acme:issue/ENG-142",
      tier: "inferred-high",
      evidence: { match: "explicit-key", key: "ENG-142" },
    });
  });

  it("a key in the branch also matches (case-insensitive)", () => {
    const input = buildInput([issue("ENG-142"), pr("1", "add verification", "feature/eng-142-x")]);
    expect(prImplementsIssueRule.evaluate(input).edges).toHaveLength(1);
  });

  it("a key that matches no crawled issue yields nothing (P3)", () => {
    const input = buildInput([issue("ENG-142"), pr("1", "ENG-999: unrelated")]);
    expect(prImplementsIssueRule.evaluate(input).edges).toHaveLength(0);
  });

  it("no jira issues → no edges", () => {
    expect(prImplementsIssueRule.evaluate(buildInput([pr("1", "ENG-142: x")])).edges).toHaveLength(
      0,
    );
  });
});
