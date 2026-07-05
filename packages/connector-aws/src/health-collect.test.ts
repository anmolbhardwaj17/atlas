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
import { CloudWatchClient, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { collectAwsHealth } from "./health-collect";

const elbMock = mockClient(ElasticLoadBalancingV2Client);
const ecsMock = mockClient(ECSClient);
const rdsMock = mockClient(RDSClient);
const cwMock = mockClient(CloudWatchClient);

const INPUT = {
  credentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
  accountId: "851725189424",
  regions: ["us-east-1"],
  now: () => new Date("2026-07-06T00:00:00Z"),
};

function emptyDefaults(): void {
  elbMock.on(DescribeLoadBalancersCommand).resolves({ LoadBalancers: [] });
  ecsMock.on(ListClustersCommand).resolves({ clusterArns: [] });
  rdsMock.on(DescribeDBInstancesCommand).resolves({ DBInstances: [] });
  cwMock.on(DescribeAlarmsCommand).resolves({ MetricAlarms: [] });
}

beforeEach(() => {
  elbMock.reset();
  ecsMock.reset();
  rdsMock.reset();
  cwMock.reset();
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
});
