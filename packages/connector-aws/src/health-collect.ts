/**
 * Runtime health collection (docs/plans/operational-intelligence.md Phase B). A cheap,
 * read-only pass over the services that expose live health — this is what lets the map
 * turn red. Distinct from crawl (structure) and from connector verify (credential
 * health): these are point-in-time observations ATTACHED to existing nodes, not nodes.
 *
 *   ELB     DescribeLoadBalancers + DescribeTargetHealth   → "2/3 targets unhealthy"
 *   ECS     ListClusters/ListServices + DescribeServices   → running vs desired, rollout state
 *   RDS     DescribeDBInstances                            → instance status
 *   Alarms  cloudwatch DescribeAlarms (StateValue=ALARM)   → mapped onto lambda/rds/elb/ecs nodes
 *
 * Trust rules: a node we successfully checked gets an explicit state (healthy included —
 * "healthy as of 12:04" is information); a node we could NOT check stays untouched =
 * `unknown`, a designed state (docs/09 §7). A denied/unavailable probe is reported in
 * `skipped`, never silently dropped (FR-1.6). Worst state wins when multiple checks
 * observe the same node.
 */
import {
  ElasticLoadBalancingV2Client,
  paginateDescribeLoadBalancers,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  ECSClient,
  paginateListClusters,
  paginateListServices,
  DescribeServicesCommand,
} from "@aws-sdk/client-ecs";
import { RDSClient, paginateDescribeDBInstances } from "@aws-sdk/client-rds";
import { CloudWatchClient, paginateDescribeAlarms } from "@aws-sdk/client-cloudwatch";
import { awsUrn } from "./urn";
import { clientConfig } from "./aws/client-config";
import { isAccessDenied } from "./permission-probe";
import type { AwsTempCredentials } from "./credentials";

export type HealthState = "healthy" | "degraded" | "unhealthy";

export interface HealthObservation {
  urn: string;
  state: HealthState;
  /** Human, one line — shown on the node ("2/3 targets unhealthy"). */
  reason: string;
  /** Citable raw facts behind the state (P4). */
  evidence: Record<string, unknown>;
  checkedAt: string;
}

export interface HealthCollectInput {
  credentials: AwsTempCredentials;
  accountId: string;
  regions: string[];
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  signal?: AbortSignal;
}

export interface HealthCollectResult {
  observations: HealthObservation[];
  /** Checks that could not run (denied/unavailable) — surfaced, never silent. */
  skipped: Array<{ check: string; region: string; iamAction: string; message: string }>;
}

const RANK: Record<HealthState, number> = { healthy: 0, degraded: 1, unhealthy: 2 };

export async function collectAwsHealth(input: HealthCollectInput): Promise<HealthCollectResult> {
  const now = input.now ?? (() => new Date());
  const byUrn = new Map<string, HealthObservation>();
  const skipped: HealthCollectResult["skipped"] = [];

  const keep = (o: HealthObservation) => {
    const prev = byUrn.get(o.urn);
    if (!prev) {
      byUrn.set(o.urn, o);
      return;
    }
    if (RANK[o.state] > RANK[prev.state]) {
      // Worse state wins; keep the earlier reason as extra evidence.
      byUrn.set(o.urn, { ...o, evidence: { ...prev.evidence, ...o.evidence } });
    } else if (RANK[o.state] === RANK[prev.state] && prev.state !== "healthy") {
      byUrn.set(o.urn, { ...prev, reason: `${prev.reason}; ${o.reason}` });
    }
  };

  for (const region of input.regions) {
    const at = now().toISOString();
    const run = async (
      check: string,
      iamAction: string,
      fn: () => Promise<void>,
    ): Promise<void> => {
      try {
        await fn();
      } catch (err) {
        if (input.signal?.aborted) throw err;
        skipped.push({
          check,
          region,
          iamAction,
          message: isAccessDenied(err) ? "access denied" : ((err as Error).message ?? "failed"),
        });
      }
    };

    await run("elb-target-health", "elasticloadbalancing:DescribeTargetHealth", () =>
      collectElb(input, region, at, keep),
    );
    await run("ecs-services", "ecs:DescribeServices", () => collectEcs(input, region, at, keep));
    await run("rds-status", "rds:DescribeDBInstances", () => collectRds(input, region, at, keep));
    await run("cloudwatch-alarms", "cloudwatch:DescribeAlarms", () =>
      collectAlarms(input, region, at, keep),
    );
  }

  return { observations: [...byUrn.values()], skipped };
}

async function collectElb(
  input: HealthCollectInput,
  region: string,
  at: string,
  keep: (o: HealthObservation) => void,
): Promise<void> {
  const client = new ElasticLoadBalancingV2Client(clientConfig(input.credentials, region));
  for await (const page of paginateDescribeLoadBalancers({ client }, {})) {
    for (const lb of page.LoadBalancers ?? []) {
      if (!lb.LoadBalancerArn || !lb.LoadBalancerName) continue;
      const urn = awsUrn("aws.elb", {
        account: input.accountId,
        region,
        naturalKey: lb.LoadBalancerName,
      });

      if (lb.State?.Code === "failed") {
        keep({
          urn,
          state: "unhealthy",
          reason: "load balancer state is failed",
          evidence: { lbState: lb.State.Code },
          checkedAt: at,
        });
        continue;
      }

      let healthy = 0;
      let unhealthy = 0;
      const tgOut = await client.send(
        new DescribeTargetGroupsCommand({ LoadBalancerArn: lb.LoadBalancerArn }),
      );
      for (const tg of tgOut.TargetGroups ?? []) {
        if (!tg.TargetGroupArn) continue;
        const th = await client.send(
          new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }),
        );
        for (const d of th.TargetHealthDescriptions ?? []) {
          if (d.TargetHealth?.State === "healthy") healthy += 1;
          else if (d.TargetHealth?.State === "unhealthy") unhealthy += 1;
        }
      }
      const total = healthy + unhealthy;
      const state: HealthState =
        total === 0
          ? "healthy"
          : unhealthy === 0
            ? "healthy"
            : healthy === 0
              ? "unhealthy"
              : "degraded";
      keep({
        urn,
        state,
        reason:
          total === 0
            ? "no registered targets in a terminal state"
            : unhealthy === 0
              ? `${healthy}/${total} targets healthy`
              : `${unhealthy}/${total} targets unhealthy`,
        evidence: { healthyTargets: healthy, unhealthyTargets: unhealthy },
        checkedAt: at,
      });
    }
  }
}

async function collectEcs(
  input: HealthCollectInput,
  region: string,
  at: string,
  keep: (o: HealthObservation) => void,
): Promise<void> {
  const client = new ECSClient(clientConfig(input.credentials, region));
  for await (const cPage of paginateListClusters({ client }, {})) {
    for (const clusterArn of cPage.clusterArns ?? []) {
      const cluster = clusterArn.split("/").pop() ?? clusterArn;
      const serviceArns: string[] = [];
      for await (const sPage of paginateListServices({ client }, { cluster: clusterArn })) {
        serviceArns.push(...(sPage.serviceArns ?? []));
      }
      for (let i = 0; i < serviceArns.length; i += 10) {
        const out = await client.send(
          new DescribeServicesCommand({
            cluster: clusterArn,
            services: serviceArns.slice(i, i + 10),
          }),
        );
        for (const svc of out.services ?? []) {
          if (!svc.serviceName) continue;
          const urn = awsUrn("aws.ecs.service", {
            account: input.accountId,
            region,
            naturalKey: `${cluster}/${svc.serviceName}`,
          });
          const desired = svc.desiredCount ?? 0;
          const running = svc.runningCount ?? 0;
          const failedRollout = (svc.deployments ?? []).some((d) => d.rolloutState === "FAILED");
          let state: HealthState = "healthy";
          let reason = `${running}/${desired} tasks running`;
          if (failedRollout) {
            state = "unhealthy";
            reason = "deployment rollout FAILED";
          } else if (desired > 0 && running === 0) {
            state = "unhealthy";
            reason = `0/${desired} tasks running`;
          } else if (running < desired) {
            state = "degraded";
          }
          keep({
            urn,
            state,
            reason,
            evidence: { desiredCount: desired, runningCount: running, failedRollout },
            checkedAt: at,
          });
        }
      }
    }
  }
}

const RDS_UNHEALTHY = new Set([
  "failed",
  "stopped",
  "storage-full",
  "inaccessible-encryption-credentials",
]);

async function collectRds(
  input: HealthCollectInput,
  region: string,
  at: string,
  keep: (o: HealthObservation) => void,
): Promise<void> {
  const client = new RDSClient(clientConfig(input.credentials, region));
  for await (const page of paginateDescribeDBInstances({ client }, {})) {
    for (const db of page.DBInstances ?? []) {
      if (!db.DBInstanceIdentifier) continue;
      const status = db.DBInstanceStatus ?? "unknown";
      const state: HealthState =
        status === "available" ? "healthy" : RDS_UNHEALTHY.has(status) ? "unhealthy" : "degraded";
      keep({
        urn: awsUrn("aws.rds.instance", {
          account: input.accountId,
          region,
          naturalKey: db.DBInstanceIdentifier,
        }),
        state,
        reason: `instance status: ${status}`,
        evidence: { dbInstanceStatus: status },
        checkedAt: at,
      });
    }
  }
}

/** Map an ALARM-state CloudWatch alarm onto the node its dimensions name (best-effort,
 *  P3: unmappable dimensions are ignored, never guessed). An alarm marks a node at
 *  least degraded — operators define alarms precisely because these matter. */
async function collectAlarms(
  input: HealthCollectInput,
  region: string,
  at: string,
  keep: (o: HealthObservation) => void,
): Promise<void> {
  const client = new CloudWatchClient(clientConfig(input.credentials, region));
  for await (const page of paginateDescribeAlarms({ client }, { StateValue: "ALARM" })) {
    for (const alarm of page.MetricAlarms ?? []) {
      const dims = new Map((alarm.Dimensions ?? []).map((d) => [d.Name ?? "", d.Value ?? ""]));
      let urn: string | null = null;
      const fn = dims.get("FunctionName");
      const db = dims.get("DBInstanceIdentifier");
      const lb = dims.get("LoadBalancer"); // "app/<name>/<hash>"
      const ecsService = dims.get("ServiceName");
      const ecsCluster = dims.get("ClusterName");
      const acct = { account: input.accountId, region };
      if (fn) urn = awsUrn("aws.lambda.function", { ...acct, naturalKey: fn });
      else if (db) urn = awsUrn("aws.rds.instance", { ...acct, naturalKey: db });
      else if (lb) {
        const name = lb.split("/")[1];
        if (name) urn = awsUrn("aws.elb", { ...acct, naturalKey: name });
      } else if (ecsService && ecsCluster) {
        urn = awsUrn("aws.ecs.service", { ...acct, naturalKey: `${ecsCluster}/${ecsService}` });
      }
      if (!urn) continue;
      keep({
        urn,
        state: "degraded",
        reason: `CloudWatch alarm firing: ${alarm.AlarmName ?? "unnamed"}`,
        evidence: {
          alarm: alarm.AlarmName,
          metric: alarm.MetricName,
          since: alarm.StateUpdatedTimestamp?.toISOString(),
        },
        checkedAt: at,
      });
    }
  }
}
