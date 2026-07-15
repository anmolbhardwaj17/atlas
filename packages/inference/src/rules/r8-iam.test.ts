import { describe, it, expect } from "vitest";
import { iamAccessConnectsRule } from "./r8-iam";
import type { EdgeLite, InferenceInput, NodeLite, SignalLite } from "../types";

function makeInput(
  nodes: NodeLite[],
  signals: SignalLite[],
  observedEdges: EdgeLite[],
): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of nodes) {
    nodesByUrn.set(n.urn, n);
    const list = nodesByKind.get(n.kind) ?? [];
    list.push(n);
    nodesByKind.set(n.kind, list);
  }
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of signals) {
    const list = signalsByKind.get(s.kind) ?? [];
    list.push(s);
    signalsByKind.set(s.kind, list);
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
const node = (urn: string, kind: string, attributes: Record<string, unknown>): NodeLite => ({
  id: urn,
  urn,
  kind,
  attributes,
});
const assumesRole = (runtimeUrn: string, roleUrn: string): EdgeLite => ({
  type: "ASSUMES_ROLE",
  fromUrn: runtimeUrn,
  toUrn: roleUrn,
});
const policy = (
  roleUrn: string,
  statements: Array<{ effect?: string; actions?: string[]; resources?: string[] }>,
): SignalLite => ({
  subjectUrn: roleUrn,
  kind: "aws.iam.policy_statements",
  data: { statements },
});

const LAMBDA = "aws:us-east-1:1:lambda:api";
const ROLE = "aws:us-east-1:1:iam-role:api-exec";
const BUCKET = "aws:us-east-1:1:s3:assets";

describe("R8 iam_access_connects", () => {
  it("a role that Allows access to a crawled bucket ARN ⇒ STORES_IN, but only inferred-LOW (permission ≠ use, P3)", () => {
    const out = iamAccessConnectsRule.evaluate(
      makeInput(
        [node(BUCKET, "aws.s3.bucket", { bucketName: "assets" })],
        [
          policy(ROLE, [
            { effect: "Allow", actions: ["s3:GetObject"], resources: ["arn:aws:s3:::assets/*"] },
          ]),
        ],
        [assumesRole(LAMBDA, ROLE)],
      ),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({
      type: "STORES_IN",
      fromUrn: LAMBDA,
      toUrn: BUCKET,
      tier: "inferred-low",
    });
    expect(out.edges[0]?.evidence).toMatchObject({ via: "iam", role: ROLE });
  });

  it("a wildcard resource (*) is ignored — too broad to be a real dependency (P3)", () => {
    const out = iamAccessConnectsRule.evaluate(
      makeInput(
        [node(BUCKET, "aws.s3.bucket", { bucketName: "assets" })],
        [policy(ROLE, [{ effect: "Allow", actions: ["s3:*"], resources: ["*"] }])],
        [assumesRole(LAMBDA, ROLE)],
      ),
    );
    expect(out.edges).toEqual([]);
  });

  it("a Deny statement never produces an edge", () => {
    const out = iamAccessConnectsRule.evaluate(
      makeInput(
        [node(BUCKET, "aws.s3.bucket", { bucketName: "assets" })],
        [policy(ROLE, [{ effect: "Deny", resources: ["arn:aws:s3:::assets/*"] }])],
        [assumesRole(LAMBDA, ROLE)],
      ),
    );
    expect(out.edges).toEqual([]);
  });

  it("a policy on a role nobody assumes ⇒ no edge", () => {
    const out = iamAccessConnectsRule.evaluate(
      makeInput(
        [node(BUCKET, "aws.s3.bucket", { bucketName: "assets" })],
        [policy(ROLE, [{ effect: "Allow", resources: ["arn:aws:s3:::assets/*"] }])],
        [],
      ),
    );
    expect(out.edges).toEqual([]);
  });

  it("an ARN for a resource we never crawled ⇒ no edge (we only link to known nodes)", () => {
    const out = iamAccessConnectsRule.evaluate(
      makeInput(
        [node(BUCKET, "aws.s3.bucket", { bucketName: "assets" })],
        [policy(ROLE, [{ effect: "Allow", resources: ["arn:aws:s3:::unknown-bucket/*"] }])],
        [assumesRole(LAMBDA, ROLE)],
      ),
    );
    expect(out.edges).toEqual([]);
  });
});
