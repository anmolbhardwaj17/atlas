/**
 * Shared resolution helpers for the connection rules (R2/R3/R8). Pure — they only read
 * the pre-indexed InferenceInput. Resolving a config/ARN reference to an EXISTING node is
 * what keeps precision high: we never invent an endpoint, we match one we already crawled.
 */
import type { InferenceInput, NodeLite } from "../types";

/** Default listener port for an RDS engine (fallback when the endpoint port is absent). */
export function portForEngine(engine: string | undefined): number | null {
  if (!engine) return null;
  const e = engine.toLowerCase();
  if (e.includes("postgres")) return 5432;
  if (e.includes("mysql") || e.includes("maria") || e === "aurora") return 3306;
  if (e.includes("sqlserver")) return 1433;
  if (e.includes("oracle")) return 1521;
  return null;
}

/** First node of `kind` whose `attributes[attr]` equals `value` (or null). */
export function findNodeByAttr(
  input: InferenceInput,
  kind: string,
  attr: string,
  value: string,
): NodeLite | null {
  for (const n of input.nodesByKind.get(kind) ?? []) {
    if (n.attributes[attr] === value) return n;
  }
  return null;
}

export interface ResourceRef {
  node: NodeLite;
  /** Storage services (S3/DynamoDB) → STORES_IN; others → CONNECTS_TO (docs/05 §6.4 R8). */
  edgeType: "STORES_IN" | "CONNECTS_TO";
}

/** Resolve a policy/statement resource ARN to a known node (S3/DynamoDB/RDS), or null. */
export function resolveResourceArn(arn: string, input: InferenceInput): ResourceRef | null {
  const s3 = /^arn:aws[a-z-]*:s3:::([^/]+)/.exec(arn);
  if (s3?.[1]) {
    const node = findNodeByAttr(input, "aws.s3.bucket", "bucketName", s3[1]);
    return node ? { node, edgeType: "STORES_IN" } : null;
  }
  const ddb = /^arn:aws[a-z-]*:dynamodb:[a-z0-9-]+:\d+:table\/([^/]+)/.exec(arn);
  if (ddb?.[1]) {
    const node = findNodeByAttr(input, "aws.dynamodb.table", "tableName", ddb[1]);
    return node ? { node, edgeType: "STORES_IN" } : null;
  }
  const rds = /^arn:aws[a-z-]*:rds:[a-z0-9-]+:\d+:db:([^:]+)/.exec(arn);
  if (rds?.[1]) {
    const node = findNodeByAttr(input, "aws.rds.instance", "dbInstanceIdentifier", rds[1]);
    return node ? { node, edgeType: "CONNECTS_TO" } : null;
  }
  return null;
}
