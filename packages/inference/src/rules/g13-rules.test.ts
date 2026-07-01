import { describe, it, expect } from "vitest";
import { sgCorrelationConnectsRule } from "./r2-sg";
import { configRefConnectsRule } from "./r3-config";
import { iamAccessConnectsRule } from "./r8-iam";
import type { EdgeLite, InferenceInput, NodeLite, SignalLite } from "../types";

function makeInput(p: {
  nodes?: NodeLite[];
  signals?: SignalLite[];
  observedEdges?: EdgeLite[];
}): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of p.nodes ?? []) {
    nodesByUrn.set(n.urn, n);
    const l = nodesByKind.get(n.kind);
    if (l) l.push(n);
    else nodesByKind.set(n.kind, [n]);
  }
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of p.signals ?? []) {
    const l = signalsByKind.get(s.kind);
    if (l) l.push(s);
    else signalsByKind.set(s.kind, [s]);
  }
  return {
    orgSlug: "acme",
    nodesByUrn,
    nodesByKind,
    signals: p.signals ?? [],
    signalsByKind,
    observedEdges: p.observedEdges ?? [],
    inferredEdges: [],
  };
}

const node = (urn: string, kind: string, attributes: Record<string, unknown>): NodeLite => ({
  id: urn,
  urn,
  kind,
  attributes,
});

const LAMBDA = "aws:us-east-1:123456789012:lambda:resize";
const RDS = "aws:us-east-1:123456789012:rds:prod-orders";
const RDS_HOST = "prod-orders.abc.us-east-1.rds.amazonaws.com";
const S3 = "aws:global:123456789012:s3:assets";
const EC2 = "aws:us-east-1:123456789012:ec2:i-0abc";
const SG_APP = "aws:us-east-1:123456789012:sg:sg-app";
const SG_DB = "aws:us-east-1:123456789012:sg:sg-db";
const ROLE = "aws:global:123456789012:iam-role:orders-task";

describe("R3 config_ref_connects", () => {
  it("env var referencing an RDS endpoint → CONNECTS_TO (high)", () => {
    const out = configRefConnectsRule.evaluate(
      makeInput({
        nodes: [node(RDS, "aws.rds.instance", { endpointAddress: RDS_HOST })],
        signals: [
          {
            subjectUrn: LAMBDA,
            kind: "aws.lambda.env",
            data: { variables: { DB_HOST: RDS_HOST } },
          },
        ],
      }),
    );
    expect(out.edges).toEqual([
      expect.objectContaining({
        type: "CONNECTS_TO",
        fromUrn: LAMBDA,
        toUrn: RDS,
        tier: "inferred-high",
      }),
    ]);
  });

  it("env var referencing an S3 bucket → STORES_IN; no matching node → nothing", () => {
    const hit = configRefConnectsRule.evaluate(
      makeInput({
        nodes: [node(S3, "aws.s3.bucket", { bucketName: "assets" })],
        signals: [
          { subjectUrn: LAMBDA, kind: "aws.lambda.env", data: { variables: { BUCKET: "assets" } } },
        ],
      }),
    );
    expect(hit.edges[0]).toMatchObject({ type: "STORES_IN", fromUrn: LAMBDA, toUrn: S3 });

    const miss = configRefConnectsRule.evaluate(
      makeInput({
        nodes: [node(S3, "aws.s3.bucket", { bucketName: "assets" })],
        signals: [
          {
            subjectUrn: LAMBDA,
            kind: "aws.lambda.env",
            data: { variables: { X: "other-bucket" } },
          },
        ],
      }),
    );
    expect(miss.edges).toEqual([]);
  });
});

describe("R2 sg_correlation_connects", () => {
  it("compute SG allowed into datastore SG on the engine port → CONNECTS_TO (high)", () => {
    const out = sgCorrelationConnectsRule.evaluate(
      makeInput({
        nodes: [
          node(EC2, "aws.ec2.instance", { vpcId: "vpc-1" }),
          node(RDS, "aws.rds.instance", { engine: "postgres", endpointPort: 5432, vpcId: "vpc-1" }),
          node(SG_APP, "aws.securitygroup", { groupId: "sg-app", vpcId: "vpc-1" }),
          node(SG_DB, "aws.securitygroup", { groupId: "sg-db", vpcId: "vpc-1" }),
        ],
        observedEdges: [
          { type: "PROTECTS", fromUrn: SG_APP, toUrn: EC2 },
          { type: "PROTECTS", fromUrn: SG_DB, toUrn: RDS },
        ],
        // sg-db ingress allows 5432 from sg-app.
        signals: [
          {
            subjectUrn: SG_DB,
            kind: "aws.sg.rules",
            data: {
              ingress: [{ protocol: "tcp", fromPort: 5432, toPort: 5432, groupRefs: ["sg-app"] }],
            },
          },
        ],
      }),
    );
    expect(out.edges).toEqual([
      expect.objectContaining({
        type: "CONNECTS_TO",
        fromUrn: EC2,
        toUrn: RDS,
        tier: "inferred-high",
      }),
    ]);
  });

  it("wrong port → no edge (P3: SG must actually reach the engine port)", () => {
    const out = sgCorrelationConnectsRule.evaluate(
      makeInput({
        nodes: [
          node(EC2, "aws.ec2.instance", { vpcId: "vpc-1" }),
          node(RDS, "aws.rds.instance", { engine: "postgres", endpointPort: 5432, vpcId: "vpc-1" }),
          node(SG_APP, "aws.securitygroup", { groupId: "sg-app", vpcId: "vpc-1" }),
          node(SG_DB, "aws.securitygroup", { groupId: "sg-db", vpcId: "vpc-1" }),
        ],
        observedEdges: [
          { type: "PROTECTS", fromUrn: SG_APP, toUrn: EC2 },
          { type: "PROTECTS", fromUrn: SG_DB, toUrn: RDS },
        ],
        signals: [
          {
            subjectUrn: SG_DB,
            kind: "aws.sg.rules",
            data: {
              ingress: [{ protocol: "tcp", fromPort: 80, toPort: 80, groupRefs: ["sg-app"] }],
            },
          },
        ],
      }),
    );
    expect(out.edges).toEqual([]);
  });
});

describe("R8 iam_access_connects", () => {
  const stmtSignal = (resources: string[]): SignalLite => ({
    subjectUrn: ROLE,
    kind: "aws.iam.policy_statements",
    data: { statements: [{ effect: "Allow", actions: ["s3:GetObject"], resources }] },
  });

  it("assumed role with a specific resource ARN → low-confidence STORES_IN", () => {
    const out = iamAccessConnectsRule.evaluate(
      makeInput({
        nodes: [node(S3, "aws.s3.bucket", { bucketName: "assets" })],
        observedEdges: [{ type: "ASSUMES_ROLE", fromUrn: LAMBDA, toUrn: ROLE }],
        signals: [stmtSignal(["arn:aws:s3:::assets/*"])],
      }),
    );
    expect(out.edges).toEqual([
      expect.objectContaining({
        type: "STORES_IN",
        fromUrn: LAMBDA,
        toUrn: S3,
        tier: "inferred-low",
      }),
    ]);
  });

  it("ignores wildcard resource grants (too broad, P3)", () => {
    const out = iamAccessConnectsRule.evaluate(
      makeInput({
        nodes: [node(S3, "aws.s3.bucket", { bucketName: "assets" })],
        observedEdges: [{ type: "ASSUMES_ROLE", fromUrn: LAMBDA, toUrn: ROLE }],
        signals: [stmtSignal(["*"])],
      }),
    );
    expect(out.edges).toEqual([]);
  });
});
