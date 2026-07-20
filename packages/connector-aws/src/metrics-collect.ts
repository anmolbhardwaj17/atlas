/**
 * On-demand CloudWatch metrics for ONE resource (operational-intelligence Phase B+).
 * Read-only GetMetricData, fetched when a user inspects a node - we are NOT a metrics
 * store (the plan's hard boundary): nothing is persisted, CloudWatch stays the system
 * of record. Each supported kind maps to its canonical health metrics.
 */
import {
  CloudWatchClient,
  GetMetricDataCommand,
  type MetricDataQuery,
} from "@aws-sdk/client-cloudwatch";
import { clientConfig } from "./aws/client-config";
import type { CrawlCredentials } from "./credentials";

export interface MetricSeries {
  /** e.g. "CPUUtilization". */
  metric: string;
  label: string;
  unit: string;
  /** Chronological [isoTime, value] pairs. */
  points: Array<[string, number]>;
}

export interface MetricsCollectInput {
  credentials: CrawlCredentials;
  region: string;
  /** Graph node kind (aws.ec2.instance | aws.lambda.function | aws.rds.instance | aws.elb | aws.ecs.service). */
  kind: string;
  /** Node attributes - dimension values come from here (instanceId, functionName, ...). */
  attributes: Record<string, unknown>;
  /** Lookback window in hours (clamped 1-24). */
  hours: number;
  signal?: AbortSignal;
}

interface Spec {
  namespace: string;
  metric: string;
  label: string;
  unit: string;
  stat: "Average" | "Sum" | "Maximum";
  dims: (a: Record<string, unknown>) => Record<string, string> | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Canonical metrics per node kind - small on purpose (2-3 each). */
const SPECS: Record<string, Spec[]> = {
  "aws.ec2.instance": [
    {
      namespace: "AWS/EC2",
      metric: "CPUUtilization",
      label: "CPU %",
      unit: "%",
      stat: "Average",
      dims: (a) => (str(a.instanceId) ? { InstanceId: str(a.instanceId) as string } : null),
    },
    {
      namespace: "AWS/EC2",
      metric: "StatusCheckFailed",
      label: "Status checks failed",
      unit: "count",
      stat: "Maximum",
      dims: (a) => (str(a.instanceId) ? { InstanceId: str(a.instanceId) as string } : null),
    },
    {
      namespace: "AWS/EC2",
      metric: "NetworkIn",
      label: "Network in",
      unit: "bytes",
      stat: "Sum",
      dims: (a) => (str(a.instanceId) ? { InstanceId: str(a.instanceId) as string } : null),
    },
  ],
  "aws.lambda.function": [
    {
      namespace: "AWS/Lambda",
      metric: "Invocations",
      label: "Invocations",
      unit: "count",
      stat: "Sum",
      dims: (a) => (str(a.functionName) ? { FunctionName: str(a.functionName) as string } : null),
    },
    {
      namespace: "AWS/Lambda",
      metric: "Errors",
      label: "Errors",
      unit: "count",
      stat: "Sum",
      dims: (a) => (str(a.functionName) ? { FunctionName: str(a.functionName) as string } : null),
    },
    {
      namespace: "AWS/Lambda",
      metric: "Duration",
      label: "Duration",
      unit: "ms",
      stat: "Average",
      dims: (a) => (str(a.functionName) ? { FunctionName: str(a.functionName) as string } : null),
    },
  ],
  "aws.rds.instance": [
    {
      namespace: "AWS/RDS",
      metric: "CPUUtilization",
      label: "CPU %",
      unit: "%",
      stat: "Average",
      dims: (a) =>
        str(a.dbInstanceIdentifier)
          ? { DBInstanceIdentifier: str(a.dbInstanceIdentifier) as string }
          : null,
    },
    {
      namespace: "AWS/RDS",
      metric: "DatabaseConnections",
      label: "Connections",
      unit: "count",
      stat: "Average",
      dims: (a) =>
        str(a.dbInstanceIdentifier)
          ? { DBInstanceIdentifier: str(a.dbInstanceIdentifier) as string }
          : null,
    },
    {
      namespace: "AWS/RDS",
      metric: "FreeStorageSpace",
      label: "Free storage",
      unit: "bytes",
      stat: "Average",
      dims: (a) =>
        str(a.dbInstanceIdentifier)
          ? { DBInstanceIdentifier: str(a.dbInstanceIdentifier) as string }
          : null,
    },
  ],
};

export function metricsSupported(kind: string): boolean {
  return kind in SPECS;
}

export async function collectNodeMetrics(input: MetricsCollectInput): Promise<MetricSeries[]> {
  const specs = SPECS[input.kind] ?? [];
  const queries: MetricDataQuery[] = [];
  const bySpec: Spec[] = [];
  for (const [i, spec] of specs.entries()) {
    const dims = spec.dims(input.attributes);
    if (!dims) continue;
    bySpec.push(spec);
    queries.push({
      Id: `m${i}`,
      MetricStat: {
        Metric: {
          Namespace: spec.namespace,
          MetricName: spec.metric,
          Dimensions: Object.entries(dims).map(([Name, Value]) => ({ Name, Value })),
        },
        Period: 300,
        Stat: spec.stat,
      },
    });
  }
  if (queries.length === 0) return [];

  const hours = Math.min(Math.max(input.hours, 1), 24);
  const client = new CloudWatchClient(clientConfig(input.credentials, input.region));
  const out = await client.send(
    new GetMetricDataCommand({
      StartTime: new Date(Date.now() - hours * 3_600_000),
      EndTime: new Date(),
      MetricDataQueries: queries,
      ScanBy: "TimestampAscending",
    }),
    ...(input.signal ? [{ abortSignal: input.signal }] : []),
  );

  const series: MetricSeries[] = [];
  for (const r of out.MetricDataResults ?? []) {
    const idx = Number((r.Id ?? "m0").slice(1));
    const spec = specs[idx];
    if (!spec) continue;
    const points: Array<[string, number]> = (r.Timestamps ?? []).map((t, i) => [
      t.toISOString(),
      r.Values?.[i] ?? 0,
    ]);
    series.push({ metric: spec.metric, label: spec.label, unit: spec.unit, points });
  }
  return series;
}
