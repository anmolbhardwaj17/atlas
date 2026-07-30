import { describe, expect, it, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
} from "@aws-sdk/client-ecs";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import {
  CloudWatchClient,
  DescribeAlarmsCommand,
  GetMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { collectAwsHealth } from "./health-collect";

const elbMock = mockClient(ElasticLoadBalancingV2Client);
const ecsMock = mockClient(ECSClient);
const rdsMock = mockClient(RDSClient);
const cwMock = mockClient(CloudWatchClient);
const lambdaMock = mockClient(LambdaClient);

const INPUT = {
  credentials: { accessKeyId: "AKIA", secretAccessKey: "s", expiration: null },
  accountId: "851725189424",
  regions: ["us-east-1"],
  now: () => new Date("2026-07-06T00:00:00Z"),
};

function emptyDefaults(): void {
  elbMock.on(DescribeLoadBalancersCommand).resolves({ LoadBalancers: [] });
  ecsMock.on(ListClustersCommand).resolves({ clusterArns: [] });
  rdsMock.on(DescribeDBInstancesCommand).resolves({ DBInstances: [] });
  cwMock.on(DescribeAlarmsCommand).resolves({ MetricAlarms: [] });
  cwMock.on(GetMetricDataCommand).resolves({ MetricDataResults: [] });
  lambdaMock.on(ListFunctionsCommand).resolves({ Functions: [] });
}

beforeEach(() => {
  elbMock.reset();
  ecsMock.reset();
  rdsMock.reset();
  cwMock.reset();
  lambdaMock.reset();
  emptyDefaults();
});

describe("collectAwsHealth", () => {
  it("ELB with mixed target health → degraded with an exact reason", async () => {
    elbMock.on(DescribeLoadBalancersCommand).resolves({
      LoadBalancers: [
        {
          LoadBalancerArn: "arn:lb",
          LoadBalancerName: "calsaws-prod-elb",
          State: { Code: "active" },
        },
      ],
    });
    elbMock
      .on(DescribeTargetGroupsCommand)
      .resolves({ TargetGroups: [{ TargetGroupArn: "arn:tg" }] });
    elbMock.on(DescribeTargetHealthCommand).resolves({
      TargetHealthDescriptions: [
        { TargetHealth: { State: "healthy" } },
        { TargetHealth: { State: "unhealthy" } },
        { TargetHealth: { State: "unhealthy" } },
      ],
    });

    const r = await collectAwsHealth(INPUT);
    const o = r.observations.find((x) => x.urn.includes(":elb:calsaws-prod-elb"));
    expect(o).toMatchObject({ state: "degraded", reason: "2/3 targets unhealthy" });
  });

  it("ECS service with 0 running of 2 desired → unhealthy; full count → healthy", async () => {
    ecsMock.on(ListClustersCommand).resolves({ clusterArns: ["arn:aws:ecs:c/prod"] });
    ecsMock.on(ListServicesCommand).resolves({ serviceArns: ["arn:svc/a", "arn:svc/b"] });
    ecsMock.on(DescribeServicesCommand).resolves({
      services: [
        { serviceName: "api", desiredCount: 2, runningCount: 0, deployments: [] },
        { serviceName: "worker", desiredCount: 1, runningCount: 1, deployments: [] },
      ],
    });

    const r = await collectAwsHealth(INPUT);
    const api = r.observations.find((x) => x.urn.endsWith("ecs-service:prod/api"));
    const worker = r.observations.find((x) => x.urn.endsWith("ecs-service:prod/worker"));
    expect(api).toMatchObject({ state: "unhealthy", reason: "0/2 tasks running" });
    expect(worker).toMatchObject({ state: "healthy" });
  });

  it("RDS status maps: available→healthy, backing-up→degraded, failed→unhealthy", async () => {
    rdsMock.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [
        { DBInstanceIdentifier: "ok-db", DBInstanceStatus: "available" },
        { DBInstanceIdentifier: "busy-db", DBInstanceStatus: "backing-up" },
        { DBInstanceIdentifier: "dead-db", DBInstanceStatus: "failed" },
      ],
    });
    const r = await collectAwsHealth(INPUT);
    const states = Object.fromEntries(
      r.observations
        .filter((o) => o.urn.includes(":rds:"))
        .map((o) => [o.urn.split(":rds:")[1], o.state]),
    );
    expect(states).toEqual({ "ok-db": "healthy", "busy-db": "degraded", "dead-db": "unhealthy" });
  });

  it("a firing CloudWatch alarm marks the dimensioned node degraded (lambda), and worst state wins on merge", async () => {
    cwMock.on(DescribeAlarmsCommand).resolves({
      MetricAlarms: [
        {
          AlarmName: "chat-errors",
          MetricName: "Errors",
          Dimensions: [{ Name: "FunctionName", Value: "calsaws-chat-processor" }],
        },
      ],
    });
    rdsMock.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [{ DBInstanceIdentifier: "dead-db", DBInstanceStatus: "failed" }],
    });
    cwMock.on(DescribeAlarmsCommand).resolvesOnce({
      MetricAlarms: [
        {
          AlarmName: "chat-errors",
          MetricName: "Errors",
          Dimensions: [{ Name: "FunctionName", Value: "calsaws-chat-processor" }],
        },
        {
          AlarmName: "db-cpu",
          MetricName: "CPUUtilization",
          Dimensions: [{ Name: "DBInstanceIdentifier", Value: "dead-db" }],
        },
      ],
    });

    const r = await collectAwsHealth(INPUT);
    const fn = r.observations.find((o) => o.urn.includes("lambda:calsaws-chat-processor"));
    expect(fn).toMatchObject({ state: "degraded" });
    expect(fn?.reason).toContain("chat-errors");
    // dead-db observed by RDS (unhealthy) AND alarm (degraded) → unhealthy wins.
    const db = r.observations.find((o) => o.urn.includes(":rds:dead-db"));
    expect(db?.state).toBe("unhealthy");
  });

  it("emits each firing alarm as an alarm_transition record keyed on its state-change time", async () => {
    const since = new Date("2026-07-31T14:05:00.000Z");
    cwMock.on(DescribeAlarmsCommand).resolves({
      MetricAlarms: [
        {
          AlarmName: "chat-errors",
          MetricName: "Errors",
          StateReason: "threshold crossed",
          StateUpdatedTimestamp: since,
          Dimensions: [{ Name: "FunctionName", Value: "calsaws-chat-processor" }],
        },
        {
          // No StateUpdatedTimestamp → no honest occurred_at / stable dedupe key: still annotates
          // health, but emits NO event (P3 — never a fabricated timestamp).
          AlarmName: "no-timestamp",
          MetricName: "Errors",
          Dimensions: [{ Name: "FunctionName", Value: "calsaws-chat-processor" }],
        },
      ],
    });

    const r = await collectAwsHealth(INPUT);
    expect(r.alarms).toHaveLength(1);
    expect(r.alarms[0]).toMatchObject({
      alarmName: "chat-errors",
      metric: "Errors",
      stateReason: "threshold crossed",
      since: since.toISOString(),
    });
    expect(r.alarms[0]?.urn).toContain("lambda:calsaws-chat-processor");
    // The alarm still drives node health (both alarms mark the function degraded) — the event is
    // additive, not a replacement.
    expect(r.observations.find((o) => o.urn.includes("calsaws-chat-processor"))?.state).toBe(
      "degraded",
    );
  });

  it("a denied check lands in skipped (named, never silent) and the rest still run", async () => {
    const denied = Object.assign(new Error("no"), { name: "AccessDenied" });
    cwMock.on(DescribeAlarmsCommand).rejects(denied);
    rdsMock.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [{ DBInstanceIdentifier: "ok-db", DBInstanceStatus: "available" }],
    });

    const r = await collectAwsHealth(INPUT);
    expect(r.skipped).toEqual([
      {
        check: "cloudwatch-alarms",
        region: "us-east-1",
        iamAction: "cloudwatch:DescribeAlarms",
        message: "access denied",
      },
    ]);
    expect(r.observations.some((o) => o.urn.includes(":rds:ok-db"))).toBe(true);
  });

  it("Lambda metric health: high error rate → unhealthy; an idle function stays unknown", async () => {
    lambdaMock.on(ListFunctionsCommand).resolves({
      Functions: [{ FunctionName: "api-handler" }, { FunctionName: "idle-fn" }],
    });
    cwMock.on(GetMetricDataCommand).resolves({
      MetricDataResults: [
        { Id: "e0", Values: [60] }, // api-handler: 60 errors …
        { Id: "t0", Values: [0] },
        { Id: "i0", Values: [100] }, // … of 100 invocations → 60% → unhealthy
        { Id: "e1", Values: [] }, // idle-fn: no activity
        { Id: "t1", Values: [] },
        { Id: "i1", Values: [] },
      ],
    });

    const r = await collectAwsHealth(INPUT);
    const api = r.observations.find((o) => o.urn.includes(":lambda:api-handler"));
    expect(api).toMatchObject({ state: "unhealthy" });
    expect(api?.reason).toMatch(/60% error rate/);
    // The idle function is left unknown (no annotation), never faked to "healthy".
    expect(r.observations.some((o) => o.urn.includes(":lambda:idle-fn"))).toBe(false);
  });

  it("Lambda throttles → degraded", async () => {
    lambdaMock.on(ListFunctionsCommand).resolves({ Functions: [{ FunctionName: "worker" }] });
    cwMock.on(GetMetricDataCommand).resolves({
      MetricDataResults: [
        { Id: "e0", Values: [0] },
        { Id: "t0", Values: [3] },
        { Id: "i0", Values: [50] },
      ],
    });
    const r = await collectAwsHealth(INPUT);
    const w = r.observations.find((o) => o.urn.includes(":lambda:worker"));
    expect(w).toMatchObject({ state: "degraded" });
    expect(w?.reason).toMatch(/3 throttle/);
  });
});
