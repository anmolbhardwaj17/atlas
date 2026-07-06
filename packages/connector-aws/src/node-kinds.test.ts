import { describe, it, expect } from "vitest";
import { AWS_NODE_KINDS, AWS_NODE_KIND_LIST, describeKind } from "./node-kinds";

describe("AWS node-kind catalog", () => {
  it("covers the full MVP catalog (docs/05 §3.1 / docs/06 §4)", () => {
    // 19 AWS kinds: 6 compute, 6 networking, 4 data, 2 identity, 1 observability (logs).
    expect(AWS_NODE_KIND_LIST.length).toBe(19);
    for (const kind of Object.keys(AWS_NODE_KINDS)) {
      expect(kind.startsWith("aws.")).toBe(true);
    }
  });

  it("has unique kinds and unique URN type discriminators", () => {
    const kinds = AWS_NODE_KIND_LIST.map((d) => d.kind);
    const types = AWS_NODE_KIND_LIST.map((d) => d.type);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(types).size).toBe(types.length);
  });

  it("scopes S3, Route53 and IAM globally; everything else regionally", () => {
    expect(describeKind("aws.s3.bucket").scope).toBe("global");
    expect(describeKind("aws.route53.record").scope).toBe("global");
    expect(describeKind("aws.iam.role").scope).toBe("global");
    expect(describeKind("aws.iam.policy").scope).toBe("global");
    expect(describeKind("aws.ec2.instance").scope).toBe("region");
    expect(describeKind("aws.rds.instance").scope).toBe("region");
  });
});
