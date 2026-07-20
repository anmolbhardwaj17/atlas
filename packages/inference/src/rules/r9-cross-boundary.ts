/**
 * R9 — cross_boundary_connects → CONNECTS_TO / STORES_IN (docs/05 §6.4, inferred-high).
 *
 * The multi-cloud stitcher. A compute config reference (env var / connection string) whose
 * value contains a datastore we've crawled links the two — REGARDLESS of which account,
 * subscription, project, or cloud each lives in, because the engine already loads every
 * node org-wide. This is how a big company's estate becomes ONE graph: an app in an AWS
 * account referencing an Azure SQL host, or a GCP Cloud Run service referencing an AWS RDS
 * endpoint, produces a link that no single cloud console can show.
 *
 * It resolves references to EXISTING nodes only (never invents an endpoint → high precision,
 * P3). Evidence flags `crossCloud` / `crossAccount` so the boundary crossing is visible.
 * Provider-partitioned with R3: R3 owns AWS-compute→AWS-datastore; R9 owns every link where
 * a non-AWS provider is involved (no double emission).
 */
import type { InferenceInput, InferredEdge, NodeLite, Rule, RuleOutput } from "../types";

interface EnvData {
  variables?: Record<string, unknown>;
}

type Edge = "CONNECTS_TO" | "STORES_IN";

/** Datastores reached by network endpoint/host (a config value CONTAINS the host). */
const ENDPOINT_DATASTORES: Array<{ kind: string; hostAttr: string; edge: Edge; match: string }> = [
  {
    kind: "aws.rds.instance",
    hostAttr: "endpointAddress",
    edge: "CONNECTS_TO",
    match: "rds-endpoint",
  },
  {
    kind: "aws.elasticache.cluster",
    hostAttr: "endpointAddress",
    edge: "CONNECTS_TO",
    match: "elasticache-endpoint",
  },
  {
    kind: "azure.sql.database",
    hostAttr: "fullyQualifiedDomainName",
    edge: "CONNECTS_TO",
    match: "azure-sql",
  },
  {
    kind: "azure.postgres",
    hostAttr: "fullyQualifiedDomainName",
    edge: "CONNECTS_TO",
    match: "azure-postgres",
  },
  { kind: "azure.cosmosdb", hostAttr: "documentEndpoint", edge: "CONNECTS_TO", match: "cosmosdb" },
  {
    kind: "gcp.cloudsql.instance",
    hostAttr: "connectionName",
    edge: "CONNECTS_TO",
    match: "cloudsql",
  },
];

/** Datastores reached by a name/bucket reference (precise match, avoids substring noise). */
const NAME_DATASTORES: Array<{
  kind: string;
  nameAttr: string;
  edge: Edge;
  match: string;
  matcher: (value: string, name: string) => boolean;
}> = [
  {
    kind: "aws.s3.bucket",
    nameAttr: "bucketName",
    edge: "STORES_IN",
    match: "s3-bucket",
    matcher: bucketMatch,
  },
  {
    kind: "aws.dynamodb.table",
    nameAttr: "tableName",
    edge: "STORES_IN",
    match: "dynamodb-table",
    matcher: (v, n) => v === n,
  },
  {
    kind: "gcp.gcs.bucket",
    nameAttr: "bucketName",
    edge: "STORES_IN",
    match: "gcs-bucket",
    matcher: (v, n) => v === n || v.includes(`gs://${n}`),
  },
  {
    kind: "azure.storage.account",
    nameAttr: "accountName",
    edge: "STORES_IN",
    match: "azure-storage",
    matcher: (v, n) => v === n || v.includes(`${n}.blob.core.windows.net`),
  },
];

const COMPUTE_ENV_SIGNALS = [
  "aws.lambda.env",
  "aws.ecs.env",
  "azure.function.env",
  "azure.appservice.env",
  "gcp.cloudrun.env",
  "gcp.cloudfunction.env",
];

function providerOf(urn: string): string {
  return urn.split(":")[0] ?? "";
}
function accountOf(node: NodeLite | undefined): string | null {
  const a = node?.attributes.accountRef;
  return typeof a === "string" ? a : null;
}

export const crossBoundaryConnectsRule: Rule = {
  key: "cross_boundary_connects",
  version: 1,
  consumesKinds: [
    "aws.rds.instance", "aws.elasticache.cluster", "azure.sql.database", "azure.postgres",
    "azure.cosmosdb", "gcp.cloudsql.instance", "aws.s3.bucket", "aws.dynamodb.table",
    "gcp.gcs.bucket", "azure.storage.account",
  ],
  consumesSignalKinds: COMPUTE_ENV_SIGNALS,
  evaluate(input: InferenceInput): RuleOutput {
    const signals = COMPUTE_ENV_SIGNALS.flatMap((k) => input.signalsByKind.get(k) ?? []);
    if (signals.length === 0) return { nodes: [], edges: [] };

    const edges: InferredEdge[] = [];
    const seen = new Set<string>();

    const add = (
      fromUrn: string,
      target: NodeLite,
      type: Edge,
      envKey: string,
      match: string,
    ): void => {
      const fromProvider = providerOf(fromUrn);
      const toProvider = providerOf(target.urn);
      // R3 owns AWS-compute → AWS-datastore; R9 only fires when a non-AWS provider is involved.
      if (fromProvider === "aws" && toProvider === "aws") return;

      const dedupe = `${fromUrn}->${target.urn}:${type}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);

      const fromAccount = accountOf(input.nodesByUrn.get(fromUrn));
      const toAccount = accountOf(target);
      edges.push({
        type,
        fromUrn,
        toUrn: target.urn,
        tier: "inferred-high",
        evidence: {
          via: "env",
          envKey,
          resource: target.urn,
          match,
          crossCloud: fromProvider !== toProvider,
          crossAccount: !!fromAccount && !!toAccount && fromAccount !== toAccount,
          fromProvider,
          toProvider,
        },
      });
    };

    for (const signal of signals) {
      const fromUrn = signal.subjectUrn;
      const vars = (signal.data as EnvData).variables ?? {};
      for (const [key, rawValue] of Object.entries(vars)) {
        const value = String(rawValue);
        for (const spec of ENDPOINT_DATASTORES) {
          for (const ds of input.nodesByKind.get(spec.kind) ?? []) {
            const host = ds.attributes[spec.hostAttr];
            if (typeof host === "string" && host && value.includes(host)) {
              add(fromUrn, ds, spec.edge, key, spec.match);
            }
          }
        }
        for (const spec of NAME_DATASTORES) {
          for (const ds of input.nodesByKind.get(spec.kind) ?? []) {
            const name = ds.attributes[spec.nameAttr];
            if (typeof name === "string" && name && spec.matcher(value, name)) {
              add(fromUrn, ds, spec.edge, key, spec.match);
            }
          }
        }
      }
    }

    return { nodes: [], edges };
  },
};

/** Precise bucket match: exact name, s3:// URL, or ARN suffix (avoids substring noise, P3). */
function bucketMatch(value: string, bucket: string): boolean {
  return value === bucket || value.includes(`s3://${bucket}`) || value.includes(`:::${bucket}`);
}
