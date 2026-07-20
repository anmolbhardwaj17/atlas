/**
 * R3 — config_ref_connects → CONNECTS_TO / STORES_IN (docs/05 §6.4, inferred-high).
 * A Lambda/ECS env var whose value references a data resource we've crawled (an RDS
 * endpoint host, an S3 bucket, a DynamoDB table) is strong intent — the config points at
 * that resource. High (deliberate config), still not observed (could be unused). Evidence
 * stores the env KEY + matched resource, not the raw value (may contain secrets).
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";

interface EnvData {
  variables?: Record<string, unknown>;
}

export const configRefConnectsRule: Rule = {
  key: "config_ref_connects",
  version: 1,
  consumesKinds: ["aws.rds.instance", "aws.s3.bucket", "aws.dynamodb.table"],
  consumesSignalKinds: ["aws.lambda.env", "aws.ecs.env"],
  evaluate(input: InferenceInput): RuleOutput {
    const rds = input.nodesByKind.get("aws.rds.instance") ?? [];
    const buckets = input.nodesByKind.get("aws.s3.bucket") ?? [];
    const tables = input.nodesByKind.get("aws.dynamodb.table") ?? [];
    if (rds.length + buckets.length + tables.length === 0) return { nodes: [], edges: [] };

    const edges: InferredEdge[] = [];
    const seen = new Set<string>();
    const add = (
      runtimeUrn: string,
      target: NodeLite,
      type: "CONNECTS_TO" | "STORES_IN",
      envKey: string,
      match: string,
    ): void => {
      const dedupe = `${runtimeUrn}->${target.urn}:${type}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      edges.push({
        type,
        fromUrn: runtimeUrn,
        toUrn: target.urn,
        tier: "inferred-high",
        evidence: { via: "env", envKey, resource: target.urn, match },
      });
    };

    const envSignals = [
      ...(input.signalsByKind.get("aws.lambda.env") ?? []),
      ...(input.signalsByKind.get("aws.ecs.env") ?? []),
    ];
    for (const signal of envSignals) {
      const runtimeUrn = signal.subjectUrn;
      const vars = (signal.data as EnvData).variables ?? {};
      for (const [key, rawValue] of Object.entries(vars)) {
        const value = String(rawValue);
        for (const db of rds) {
          const host = db.attributes.endpointAddress;
          if (typeof host === "string" && host && value.includes(host)) {
            add(runtimeUrn, db, "CONNECTS_TO", key, "rds-endpoint");
          }
        }
        for (const b of buckets) {
          const bucket = b.attributes.bucketName;
          if (typeof bucket === "string" && bucket && matchesBucket(value, bucket)) {
            add(runtimeUrn, b, "STORES_IN", key, "s3-bucket");
          }
        }
        for (const t of tables) {
          const name = t.attributes.tableName;
          if (typeof name === "string" && name && value === name) {
            add(runtimeUrn, t, "STORES_IN", key, "dynamodb-table");
          }
        }
      }
    }
    return { nodes: [], edges };
  },
};

/** Precise bucket match: exact name, s3:// URL, or ARN suffix (avoids substring noise, P3). */
function matchesBucket(value: string, bucket: string): boolean {
  return value === bucket || value.includes(`s3://${bucket}`) || value.includes(`:::${bucket}`);
}
