import { describe, it, expect } from "vitest";
import { configRefConnectsRule } from "./r3-config";
import type { InferenceInput, NodeLite, SignalLite } from "../types";

function makeInput(nodes: NodeLite[], signals: SignalLite[]): InferenceInput {
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
    observedEdges: [],
    inferredEdges: [],
  };
}
const node = (urn: string, kind: string, attributes: Record<string, unknown>): NodeLite => ({
  id: urn,
  urn,
  kind,
  attributes,
});
const env = (subjectUrn: string, variables: Record<string, string>): SignalLite => ({
  subjectUrn,
  kind: "aws.lambda.env",
  data: { variables },
});

const LAMBDA = "aws:us-east-1:1:lambda:api";
const RDS = "aws:us-east-1:1:rds:orders";
const RDS_HOST = "orders.abc.us-east-1.rds.amazonaws.com";
const BUCKET = "aws:us-east-1:1:s3:assets";
const TABLE = "aws:us-east-1:1:dynamodb:sessions";

describe("R3 config_ref_connects", () => {
  it("env var containing the RDS endpoint host ⇒ CONNECTS_TO (high), evidence keeps the KEY not the value", () => {
    const out = configRefConnectsRule.evaluate(
      makeInput(
        [node(RDS, "aws.rds.instance", { endpointAddress: RDS_HOST })],
        [env(LAMBDA, { DATABASE_URL: `postgres://u:secret@${RDS_HOST}:5432/orders` })],
      ),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ type: "CONNECTS_TO", fromUrn: LAMBDA, toUrn: RDS });
    // Secret hygiene: evidence records the env key + which resource, never the raw value.
    expect(out.edges[0]?.evidence).toMatchObject({ via: "env", envKey: "DATABASE_URL" });
    expect(JSON.stringify(out.edges[0]?.evidence)).not.toContain("secret");
  });

  it("env var referencing an S3 bucket via s3:// ⇒ STORES_IN", () => {
    const out = configRefConnectsRule.evaluate(
      makeInput(
        [node(BUCKET, "aws.s3.bucket", { bucketName: "assets" })],
        [env(LAMBDA, { UPLOADS: "s3://assets/incoming" })],
      ),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ type: "STORES_IN", toUrn: BUCKET });
  });

  it("DynamoDB match requires the EXACT table name (no substring noise, P3)", () => {
    const exact = configRefConnectsRule.evaluate(
      makeInput(
        [node(TABLE, "aws.dynamodb.table", { tableName: "sessions" })],
        [env(LAMBDA, { TABLE: "sessions" })],
      ),
    );
    expect(exact.edges).toHaveLength(1);
    expect(exact.edges[0]).toMatchObject({ type: "STORES_IN", toUrn: TABLE });

    const substring = configRefConnectsRule.evaluate(
      makeInput(
        [node(TABLE, "aws.dynamodb.table", { tableName: "sessions" })],
        [env(LAMBDA, { TABLE: "sessions-staging" })],
      ),
    );
    expect(substring.edges).toEqual([]);
  });

  it("a value that references nothing we crawled ⇒ no edge", () => {
    const out = configRefConnectsRule.evaluate(
      makeInput(
        [node(RDS, "aws.rds.instance", { endpointAddress: RDS_HOST })],
        [env(LAMBDA, { LOG_LEVEL: "debug" })],
      ),
    );
    expect(out.edges).toEqual([]);
  });

  it("no data resources in the estate ⇒ short-circuits", () => {
    const out = configRefConnectsRule.evaluate(makeInput([], [env(LAMBDA, { X: "y" })]));
    expect(out.edges).toEqual([]);
  });
});
