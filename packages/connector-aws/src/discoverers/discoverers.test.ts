import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketNotificationConfigurationCommand,
  GetBucketTaggingCommand,
} from "@aws-sdk/client-s3";
import { ec2InstanceDiscoverer } from "./ec2";
import { lambdaDiscoverer } from "./lambda";
import { s3Discoverer } from "./s3";
import { probeFromDiscoverer } from "../aws/discoverer";
import { classifyAwsError } from "../aws/retry";
import type { CrawlScopeInput, DiscoveredResource } from "../aws/discoverer";

const creds = { accessKeyId: "A", secretAccessKey: "S", sessionToken: "T", expiration: null };
const region: CrawlScopeInput = {
  credentials: creds,
  account: "123456789012",
  region: "us-east-1",
};
const global: CrawlScopeInput = { credentials: creds, account: "123456789012", region: "global" };

async function collect(it: AsyncIterable<DiscoveredResource>): Promise<DiscoveredResource[]> {
  const out: DiscoveredResource[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const ec2Mock = mockClient(EC2Client);
const lambdaMock = mockClient(LambdaClient);
const s3Mock = mockClient(S3Client);

beforeEach(() => {
  ec2Mock.reset();
  lambdaMock.reset();
  s3Mock.reset();
});

describe("ec2InstanceDiscoverer", () => {
  it("flattens reservations → instance refs with account/region payloads", async () => {
    ec2Mock.on(DescribeInstancesCommand).resolves({
      Reservations: [{ Instances: [{ InstanceId: "i-1" }, { InstanceId: "i-2" }] }],
    });
    const items = await collect(ec2InstanceDiscoverer.crawl(region));
    expect(items.map((i) => i.ref.externalId)).toEqual(["i-1", "i-2"]);
    expect(items[0]?.ref.kind).toBe("aws.ec2.instance");
    expect(items[0]?.ref.scopeKey).toBe("us-east-1/ec2");
    expect(items[0]?.payload).toMatchObject({ account: "123456789012", region: "us-east-1" });
  });
});

describe("lambdaDiscoverer", () => {
  it("yields functions from ListFunctions (collapsed detail)", async () => {
    lambdaMock.on(ListFunctionsCommand).resolves({
      Functions: [{ FunctionName: "resize", Role: "arn:aws:iam::123456789012:role/r" }],
    });
    const items = await collect(lambdaDiscoverer.crawl(region));
    expect(items).toHaveLength(1);
    expect(items[0]?.ref.externalId).toBe("resize");
  });
});

describe("s3Discoverer (multi-call enrichment, global)", () => {
  it("assembles bucket location + notifications + tags, tolerating NoSuchTagSet", async () => {
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [{ Name: "assets" }] });
    s3Mock.on(GetBucketLocationCommand).resolves({ LocationConstraint: "us-west-2" });
    s3Mock.on(GetBucketNotificationConfigurationCommand).resolves({
      LambdaFunctionConfigurations: [
        {
          LambdaFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:resize",
          Events: ["s3:ObjectCreated:*"],
        },
      ],
    });
    s3Mock
      .on(GetBucketTaggingCommand)
      .rejects(Object.assign(new Error("no tags"), { name: "NoSuchTagSet" }));

    const items = await collect(s3Discoverer.crawl(global));
    expect(items).toHaveLength(1);
    const data = items[0]?.payload.data as {
      Name: string;
      LocationConstraint: string;
      NotificationConfiguration: { LambdaFunctionConfigurations: unknown[] };
    };
    expect(items[0]?.ref.scopeKey).toBe("global/s3");
    expect(data.LocationConstraint).toBe("us-west-2");
    expect(data.NotificationConfiguration.LambdaFunctionConfigurations).toHaveLength(1);
  });
});

describe("probeFromDiscoverer", () => {
  it("triggers the underlying call and propagates AccessDenied (→ permission detection)", async () => {
    ec2Mock
      .on(DescribeInstancesCommand)
      .rejects(Object.assign(new Error("denied"), { name: "AccessDenied" }));
    const probe = probeFromDiscoverer(ec2InstanceDiscoverer);
    await expect(
      probe.probe({ credentials: creds, accountId: "123456789012", region: "us-east-1" }),
    ).rejects.toSatisfy((e: unknown) => classifyAwsError(e) === "access-denied");
  });

  it("succeeds (no throw) when the first page returns", async () => {
    ec2Mock
      .on(DescribeInstancesCommand)
      .resolves({ Reservations: [{ Instances: [{ InstanceId: "i-1" }] }] });
    const probe = probeFromDiscoverer(ec2InstanceDiscoverer);
    await expect(
      probe.probe({ credentials: creds, accountId: "123456789012", region: "us-east-1" }),
    ).resolves.toBeUndefined();
  });
});
