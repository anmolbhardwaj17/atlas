import { describe, it, expect } from "vitest";
import { awsUrn } from "./urn";
import { AWS_NODE_KINDS, AWS_NODE_KIND_LIST } from "./node-kinds";

const ACCT = "123456789012";

describe("awsUrn", () => {
  it("matches the documented region-scoped patterns (docs/05 §2.2)", () => {
    expect(
      awsUrn("aws.lambda.function", {
        account: ACCT,
        region: "us-east-1",
        naturalKey: "checkout-processor",
      }),
    ).toBe("aws:us-east-1:123456789012:lambda:checkout-processor");
    expect(
      awsUrn("aws.rds.instance", { account: ACCT, region: "us-east-1", naturalKey: "prod-orders" }),
    ).toBe("aws:us-east-1:123456789012:rds:prod-orders");
    expect(
      awsUrn("aws.ecs.service", {
        account: ACCT,
        region: "us-east-1",
        naturalKey: "prod/orders-api",
      }),
    ).toBe("aws:us-east-1:123456789012:ecs-service:prod/orders-api");
    expect(
      awsUrn("aws.securitygroup", { account: ACCT, region: "us-east-1", naturalKey: "sg-0abc123" }),
    ).toBe("aws:us-east-1:123456789012:sg:sg-0abc123");
  });

  it("uses the literal `global` scope for globally-scoped kinds (docs/05 §2.2)", () => {
    expect(awsUrn("aws.s3.bucket", { account: ACCT, naturalKey: "acme-prod-assets" })).toBe(
      "aws:global:123456789012:s3:acme-prod-assets",
    );
    // region, if supplied for a global kind, is ignored — identity stays global (no double-count).
    expect(
      awsUrn("aws.s3.bucket", {
        account: ACCT,
        region: "eu-west-1",
        naturalKey: "acme-prod-assets",
      }),
    ).toBe("aws:global:123456789012:s3:acme-prod-assets");
    expect(awsUrn("aws.iam.role", { account: ACCT, naturalKey: "atlas-readonly" })).toBe(
      "aws:global:123456789012:iam-role:atlas-readonly",
    );
  });

  it("is deterministic — same inputs yield the same URN (docs/05 §2.3)", () => {
    const a = awsUrn("aws.ec2.instance", {
      account: ACCT,
      region: "us-east-1",
      naturalKey: "i-0abc",
    });
    const b = awsUrn("aws.ec2.instance", {
      account: ACCT,
      region: "us-east-1",
      naturalKey: "i-0abc",
    });
    expect(a).toBe(b);
  });

  it("lowercases the region but preserves a case-significant natural key", () => {
    expect(
      awsUrn("aws.lambda.function", { account: ACCT, region: "US-EAST-1", naturalKey: "MyFn" }),
    ).toBe("aws:us-east-1:123456789012:lambda:MyFn");
  });

  it("requires region for region-scoped kinds, and rejects empty account/key", () => {
    expect(() => awsUrn("aws.ec2.instance", { account: ACCT, naturalKey: "i-0abc" })).toThrow(
      /region is required/,
    );
    expect(() => awsUrn("aws.s3.bucket", { account: "", naturalKey: "b" })).toThrow(
      /account is required/,
    );
    expect(() => awsUrn("aws.s3.bucket", { account: ACCT, naturalKey: "  " })).toThrow(
      /naturalKey is required/,
    );
  });

  it("produces a valid 5-segment URN for every kind in the catalog", () => {
    for (const desc of AWS_NODE_KIND_LIST) {
      const urn = awsUrn(desc.kind as keyof typeof AWS_NODE_KINDS, {
        account: ACCT,
        region: "us-east-1",
        naturalKey: "key",
      });
      const segments = urn.split(":");
      expect(segments.length).toBe(5);
      expect(segments[0]).toBe("aws");
      expect(segments[1]).toBe(desc.scope === "global" ? "global" : "us-east-1");
      expect(segments[2]).toBe(ACCT);
      expect(segments[3]).toBe(desc.type);
    }
  });
});
