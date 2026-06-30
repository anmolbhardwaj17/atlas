import { describe, it, expect } from "vitest";
import type { Connection, RawResource, SecretAccessor, SyncRun } from "@atlas/connector-sdk";
import { AwsConnector } from "./aws-connector";
import type { CredentialProvider } from "./credentials";
import type { AwsRawPayload } from "./services/module";

const ACCT = "123456789012";
const secrets: SecretAccessor = { get: async () => ({ externalId: "e" }) };
const creds: CredentialProvider = {
  assumeRole: async () => ({
    accountId: ACCT,
    credentials: { accessKeyId: "A", secretAccessKey: "S", sessionToken: "T", expiration: null },
  }),
};

function connector(): AwsConnector {
  return new AwsConnector({ credentials: creds, secrets });
}

const conn: Connection = {
  id: "c1",
  orgId: "o1",
  provider: "aws",
  displayName: "aws",
  config: {
    roleArn: `arn:aws:iam::${ACCT}:role/AtlasReadOnly`,
    regions: ["us-east-1", "eu-west-1"],
  },
  secretRef: "ref",
};
const run: SyncRun = { id: "r1", orgId: "o1", connectionId: "c1", type: "full", checkpoint: {} };

describe("AwsConnector.plan", () => {
  it("fans region-scoped services across regions and global services once", async () => {
    const { scopes } = await connector().plan(conn, run);
    const keys = scopes.map((s) => s.key);

    // Region-scoped service appears per region.
    expect(keys).toContain("us-east-1/ec2");
    expect(keys).toContain("eu-west-1/ec2");
    // Global services appear exactly once (URN scope = global, no per-region dup).
    expect(keys.filter((k) => k === "global/s3")).toHaveLength(1);
    expect(keys.filter((k) => k === "global/iam")).toHaveLength(1);
    expect(keys.filter((k) => k === "global/route53")).toHaveLength(1);
    expect(keys.some((k) => k.startsWith("us-east-1/s3"))).toBe(false);

    // Every scope carries region+service params for discover (I1.4).
    for (const s of scopes) {
      expect(s.params).toHaveProperty("service");
      expect(s.params).toHaveProperty("region");
    }
  });
});

describe("AwsConnector pure dispatch", () => {
  it("routes normalize/observedEdges to the module matching ref.kind", () => {
    const raw: RawResource = {
      ref: { scopeKey: "us-east-1/subnet", externalId: "subnet-1", kind: "aws.subnet" },
      payload: {
        account: ACCT,
        region: "us-east-1",
        data: { SubnetId: "subnet-1", VpcId: "vpc-1" },
      } satisfies AwsRawPayload,
      fetchedAt: "2026-07-01T00:00:00.000Z",
    };
    const c = connector();
    expect(c.normalize(raw).kind).toBe("aws.subnet");
    expect(c.observedEdges(raw)[0]).toMatchObject({ type: "CONTAINS" });
  });

  it("throws for an unknown kind", () => {
    const raw: RawResource = {
      ref: { scopeKey: "x", externalId: "y", kind: "aws.unknown" },
      payload: { account: ACCT, region: "us-east-1", data: {} },
      fetchedAt: "2026-07-01T00:00:00.000Z",
    };
    expect(() => connector().normalize(raw)).toThrow(/No AWS service module/);
  });
});
