import { describe, expect, it, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";
import { collectCloudTrailEvents } from "./cloudtrail-collect";

const ctMock = mockClient(CloudTrailClient);

const INPUT = {
  credentials: { accessKeyId: "AKIA", secretAccessKey: "s", expiration: null },
  accountId: "851725189424",
  regions: ["us-east-1"],
  since: new Date("2026-07-05T00:00:00Z"),
};

beforeEach(() => ctMock.reset());

describe("collectCloudTrailEvents", () => {
  it("maps write events onto crawled node URNs (SG by id, Lambda by name, ELB from ARN)", async () => {
    ctMock.on(LookupEventsCommand).resolves({
      Events: [
        {
          EventId: "e1",
          EventName: "AuthorizeSecurityGroupIngress",
          EventTime: new Date("2026-07-05T14:02:00Z"),
          Username: "readonly-anmol",
          EventSource: "ec2.amazonaws.com",
          Resources: [{ ResourceType: "AWS::EC2::SecurityGroup", ResourceName: "sg-0abc" }],
        },
        {
          EventId: "e2",
          EventName: "UpdateFunctionCode20150331v2",
          EventTime: new Date("2026-07-05T14:05:00Z"),
          Username: "deployer",
          EventSource: "lambda.amazonaws.com",
          Resources: [
            {
              ResourceType: "AWS::Lambda::Function",
              ResourceName: "arn:aws:lambda:us-east-1:851725189424:function:calsaws-chat-processor",
            },
          ],
        },
        {
          EventId: "e3",
          EventName: "ModifyLoadBalancerAttributes",
          EventTime: new Date("2026-07-05T15:00:00Z"),
          Resources: [
            {
              ResourceType: "AWS::ElasticLoadBalancingV2::LoadBalancer",
              ResourceName:
                "arn:aws:elasticloadbalancing:us-east-1:851725189424:loadbalancer/app/calsaws-prod-elb-001/50dc6c",
            },
          ],
        },
      ],
    });

    const r = await collectCloudTrailEvents(INPUT);
    expect(r.skipped).toEqual([]);
    const byName = Object.fromEntries(r.events.map((e) => [e.eventName, e.urn]));
    expect(byName["AuthorizeSecurityGroupIngress"]).toBe("aws:us-east-1:851725189424:sg:sg-0abc");
    expect(byName["UpdateFunctionCode20150331v2"]).toBe(
      "aws:us-east-1:851725189424:lambda:calsaws-chat-processor",
    );
    expect(byName["ModifyLoadBalancerAttributes"]).toBe(
      "aws:us-east-1:851725189424:elb:calsaws-prod-elb-001",
    );
    expect(r.events.find((e) => e.eventName === "AuthorizeSecurityGroupIngress")?.actor).toBe(
      "readonly-anmol",
    );
  });

  it("drops events whose resources can't be resolved - never guesses (P3)", async () => {
    ctMock.on(LookupEventsCommand).resolves({
      Events: [
        {
          EventId: "e4",
          EventName: "CreateGrant",
          EventTime: new Date("2026-07-05T16:00:00Z"),
          Resources: [{ ResourceType: "AWS::KMS::Key", ResourceName: "k-1" }],
        },
        {
          EventId: "e5",
          EventName: "ConsoleLogin",
          EventTime: new Date("2026-07-05T16:01:00Z"),
          Resources: [],
        },
      ],
    });
    const r = await collectCloudTrailEvents(INPUT);
    expect(r.events).toEqual([]);
  });

  it("a denied region lands in skipped, named", async () => {
    const denied = Object.assign(new Error("nope"), { name: "AccessDeniedException" });
    ctMock.on(LookupEventsCommand).rejects(denied);
    const r = await collectCloudTrailEvents(INPUT);
    expect(r.events).toEqual([]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.message).toContain("access denied");
  });
});
