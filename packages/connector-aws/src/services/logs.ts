/**
 * CloudWatch Log Groups → workload intelligence (operational-intelligence "reverse-
 * engineering" layer). A log group's NAME says what writes to it — `/aws/lambda/<fn>`,
 * `/ecs/<family>`, `/ec2/<app>`, or a bare custom app name — which is free, read-only
 * evidence of what runs INSIDE compute we cannot see into (EC2 especially). The module
 * emits each log group as a support-data node (excluded from the map/estate browse like
 * external.package) plus an `aws.logs.workload` signal; inference rule R10 correlates
 * those workloads with Bitbucket repositories and the compute they run on.
 */
import type { Signal } from "@atlas/connector-sdk";
import { awsUrn } from "../urn";
import type { ServiceModule } from "./module";

export interface LogGroupData {
  logGroupName: string;
  storedBytes?: number;
  retentionInDays?: number;
  creationTime?: number;
}

export type WorkloadHost = "lambda" | "ecs" | "ec2" | "aws-managed" | "unknown";

export interface LogWorkload {
  /** The raw workload token parsed from the name (e.g. "calsaws-backend-api"). */
  name: string;
  /** Where the name says it runs. `unknown` = a custom app name (often EC2-resident). */
  host: WorkloadHost;
}

/** AWS-managed namespaces whose logs are service plumbing, not customer code. */
const AWS_MANAGED =
  /^\/aws\/(rds|apigateway|vpc|route53|cloudtrail|codebuild|eks\/|elasticbeanstalk\/health|containerinsights)/;

/** Parse a log-group name into the workload it evidences (null = nothing usable). */
export function parseLogGroupWorkload(logGroupName: string): LogWorkload | null {
  const n = logGroupName.trim();
  if (!n) return null;
  if (AWS_MANAGED.test(n)) return { name: n, host: "aws-managed" };
  let m = /^\/aws\/lambda\/(.+)$/.exec(n);
  if (m) return { name: m[1] as string, host: "lambda" };
  m = /^\/(?:aws\/)?ecs\/(.+)$/.exec(n);
  if (m) return { name: (m[1] as string).split("/")[0] as string, host: "ecs" };
  m = /^\/ec2\/(.+)$/.exec(n);
  if (m) return { name: (m[1] as string).split("/")[0] as string, host: "ec2" };
  m = /^\/var\/log\/(.+)$/.exec(n);
  if (m) return { name: (m[1] as string).split("/")[0] as string, host: "ec2" };
  // Custom name: strip leading slashes, take the first path segment.
  const first = n.replace(/^\/+/, "").split("/")[0] as string;
  return first ? { name: first, host: "unknown" } : null;
}

export const logsModule: ServiceModule<LogGroupData> = {
  kind: "aws.logs.group",
  service: "logs",
  scope: "region",
  normalize({ account, region, data }) {
    return {
      urn: awsUrn("aws.logs.group", { account, region, naturalKey: data.logGroupName }),
      kind: "aws.logs.group",
      displayName: data.logGroupName,
      attributes: {
        region,
        accountRef: account,
        logGroupName: data.logGroupName,
        storedBytes: data.storedBytes,
        retentionInDays: data.retentionInDays,
      },
    };
  },
  observedEdges() {
    return [];
  },
  extractSignals({ account, region, data }): Signal[] {
    const workload = parseLogGroupWorkload(data.logGroupName);
    if (!workload || workload.host === "aws-managed") return [];
    return [
      {
        kind: "aws.logs.workload",
        subjectUrn: awsUrn("aws.logs.group", { account, region, naturalKey: data.logGroupName }),
        data: {
          logGroup: data.logGroupName,
          name: workload.name,
          host: workload.host,
          account,
          region,
          /** Active workloads have bytes - a dead log group is weaker evidence. */
          storedBytes: data.storedBytes ?? 0,
        },
      },
    ];
  },
};
