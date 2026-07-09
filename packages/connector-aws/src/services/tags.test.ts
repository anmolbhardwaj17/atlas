/**
 * Tag capture for R11 (docs/plans/signal-enrichment.md): the compute/data modules must fold
 * whatever tag shape their API returns onto `attributes.tags` (a flat record), so the
 * tag_code_correlation rule can match them to repos. Lambda ListTags returns a record;
 * ECS returns a `{key,value}` array; RDS/ElastiCache return a `{Key,Value}` array.
 */
import { describe, it, expect } from "vitest";
import type { AwsRawPayload } from "./module";
import { lambdaModule, ec2Module } from "./compute";
import { ecsServiceModule, ecsTaskDefModule } from "./ecs";
import { rdsModule } from "./data";
import { elasticacheModule } from "./additive";

const ACCT = "123456789012";
const REGION = "us-east-1";
function p<T>(data: T): AwsRawPayload<T> {
  return { account: ACCT, region: REGION, data };
}
const tags = (n: { attributes: Record<string, unknown> }): Record<string, string> =>
  n.attributes.tags as Record<string, string>;

describe("tag capture (R11 inputs)", () => {
  it("Lambda folds its flat ListTags record onto attributes.tags", () => {
    const node = lambdaModule.normalize(
      p({ FunctionName: "pay-fn", Tags: { repository: "payments" } }),
    );
    expect(tags(node).repository).toBe("payments");
  });

  it("Lambda without tags gets an empty record (never undefined)", () => {
    const node = lambdaModule.normalize(p({ FunctionName: "pay-fn" }));
    expect(tags(node)).toEqual({});
  });

  it("ECS service folds the {key,value} tag array", () => {
    const node = ecsServiceModule.normalize(
      p({
        serviceName: "orders",
        clusterArn: `arn:aws:ecs:${REGION}:${ACCT}:cluster/prod`,
        tags: [{ key: "service", value: "orders-api" }],
      }),
    );
    expect(tags(node).service).toBe("orders-api");
  });

  it("ECS task definition folds the {key,value} tag array", () => {
    const node = ecsTaskDefModule.normalize(
      p({ family: "orders", tags: [{ key: "project", value: "orders-api" }] }),
    );
    expect(tags(node).project).toBe("orders-api");
  });

  it("RDS folds the inline TagList", () => {
    const node = rdsModule.normalize(
      p({
        DBInstanceIdentifier: "orders-db",
        Engine: "postgres",
        TagList: [{ Key: "repository", Value: "orders" }],
      }),
    );
    expect(tags(node).repository).toBe("orders");
  });

  it("ElastiCache folds the TagList", () => {
    const node = elasticacheModule.normalize(
      p({
        CacheClusterId: "sessions",
        Engine: "redis",
        TagList: [{ Key: "application", Value: "sessions-svc" }],
      }),
    );
    expect(tags(node).application).toBe("sessions-svc");
  });

  it("EC2 still captures DescribeInstances tags (unchanged)", () => {
    const node = ec2Module.normalize(
      p({ InstanceId: "i-1", Tags: [{ Key: "service", Value: "worker" }] }),
    );
    expect(tags(node).service).toBe("worker");
  });
});
