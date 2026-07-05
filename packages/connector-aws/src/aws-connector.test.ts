import { describe, it, expect } from "vitest";
import type { Connection, SecretAccessor } from "@atlas/connector-sdk";
import { AwsConnector } from "./aws-connector";
import {
  AssumeRoleError,
  type AssumeRoleInput,
  type CredentialProvider,
  type StaticCredentialInput,
  type StaticCredentialResolver,
} from "./credentials";
import type { PermissionProbe } from "./permission-probe";

const ACCT = "123456789012";

function conn(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    orgId: "org-1",
    provider: "aws",
    displayName: "prod aws",
    config: { roleArn: `arn:aws:iam::${ACCT}:role/AtlasReadOnly`, regions: ["us-east-1"] },
    secretRef: "mem:org-1:abc",
    ...overrides,
  };
}

const okSecrets: SecretAccessor = { get: async () => ({ externalId: "ext-123" }) };

function okCreds(captured?: (i: AssumeRoleInput) => void): CredentialProvider {
  return {
    assumeRole: async (input) => {
      captured?.(input);
      return {
        accountId: ACCT,
        credentials: {
          accessKeyId: "A",
          secretAccessKey: "S",
          sessionToken: "T",
          expiration: null,
        },
      };
    },
  };
}

function probe(
  service: string,
  iamAction: string,
  behavior: "ok" | "denied" | "transient",
): PermissionProbe {
  return {
    service,
    iamAction,
    scope: "region",
    probe: async () => {
      if (behavior === "denied") throw Object.assign(new Error("no"), { name: "AccessDenied" });
      if (behavior === "transient")
        throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    },
  };
}

describe("AwsConnector.verify", () => {
  it("returns connected when AssumeRole succeeds and all probes pass", async () => {
    const c = new AwsConnector({
      credentials: okCreds(),
      secrets: okSecrets,
      probes: [probe("ec2", "ec2:DescribeInstances", "ok")],
    });
    expect(await c.verify(conn())).toEqual({ status: "connected" });
  });

  it("passes the External ID and a traceable sessionName to AssumeRole", async () => {
    let seen: AssumeRoleInput | undefined;
    const c = new AwsConnector({ credentials: okCreds((i) => (seen = i)), secrets: okSecrets });
    await c.verify(conn());
    expect(seen?.externalId).toBe("ext-123");
    expect(seen?.roleArn).toBe(`arn:aws:iam::${ACCT}:role/AtlasReadOnly`);
    expect(seen?.sessionName).toMatch(/^atlas-verify-conn-1$/);
  });

  it("returns degraded with the missing IAM actions when some probes are denied (docs/06 §8)", async () => {
    const c = new AwsConnector({
      credentials: okCreds(),
      secrets: okSecrets,
      probes: [
        probe("ec2", "ec2:DescribeInstances", "ok"),
        probe("rds", "rds:DescribeDBInstances", "denied"),
        probe("s3", "s3:ListAllMyBuckets", "denied"),
      ],
    });
    const r = await c.verify(conn());
    expect(r.status).toBe("degraded");
    expect(r.missingPermissions).toEqual(["rds:DescribeDBInstances", "s3:ListAllMyBuckets"]);
  });

  it("does NOT treat a transient (non-access-denied) probe error as a missing permission", async () => {
    const c = new AwsConnector({
      credentials: okCreds(),
      secrets: okSecrets,
      probes: [probe("ec2", "ec2:DescribeInstances", "transient")],
    });
    expect(await c.verify(conn())).toEqual({ status: "connected" });
  });

  it("returns error when AssumeRole fails (revoked role / bad External ID)", async () => {
    const creds: CredentialProvider = {
      assumeRole: async () => {
        throw new AssumeRoleError("AssumeRole was denied.");
      },
    };
    const r = await c2(creds).verify(conn());
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/denied/i);
  });

  it("returns error for invalid config or missing External ID (US-1 negative)", async () => {
    const c = c2(okCreds());
    expect((await c.verify(conn({ config: { regions: ["us-east-1"] } }))).status).toBe("error");
    expect((await c.verify(conn({ secretRef: null }))).status).toBe("error");

    const emptyExt = new AwsConnector({
      credentials: okCreds(),
      secrets: { get: async () => ({}) },
    });
    expect((await emptyExt.verify(conn())).status).toBe("error");
  });

  it("health() runs the same probe with a health sessionName", async () => {
    let seen: AssumeRoleInput | undefined;
    const c = new AwsConnector({ credentials: okCreds((i) => (seen = i)), secrets: okSecrets });
    expect((await c.health(conn())).status).toBe("connected");
    expect(seen?.sessionName).toMatch(/^atlas-health-conn-1$/);
  });
});

function c2(credentials: CredentialProvider): AwsConnector {
  return new AwsConnector({ credentials, secrets: okSecrets });
}

// ── Static access-key auth mode (no roleArn; keys are the secret) ──────────────
const keysConn = (overrides: Partial<Connection> = {}): Connection =>
  conn({ config: { regions: ["us-east-1"] }, ...overrides });

const keysSecrets: SecretAccessor = {
  get: async () => ({ accessKeyId: "AKIA_TEST", secretAccessKey: "shhh" }),
};

function okStatic(captured?: (i: StaticCredentialInput) => void): StaticCredentialResolver {
  return {
    resolve: async (input) => {
      captured?.(input);
      return {
        accountId: ACCT,
        credentials: {
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey,
          expiration: null,
        },
      };
    },
  };
}

describe("AwsConnector.verify — static access keys (keys mode)", () => {
  it("validates the keys via the static resolver and returns connected", async () => {
    let seen: StaticCredentialInput | undefined;
    const c = new AwsConnector({
      credentials: okCreds(),
      staticCredentials: okStatic((i) => (seen = i)),
      secrets: keysSecrets,
      probes: [probe("ec2", "ec2:DescribeInstances", "ok")],
    });
    expect(await c.verify(keysConn())).toEqual({ status: "connected" });
    expect(seen?.accessKeyId).toBe("AKIA_TEST");
    expect(seen?.secretAccessKey).toBe("shhh");
  });

  it("returns error when AWS rejects the keys (resolver throws)", async () => {
    const c = new AwsConnector({
      credentials: okCreds(),
      staticCredentials: {
        resolve: async () => {
          throw new AssumeRoleError("AWS rejected these access keys.");
        },
      },
      secrets: keysSecrets,
    });
    const r = await c.verify(keysConn());
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/rejected these access keys/i);
  });

  it("returns error when the keys secret is missing/empty", async () => {
    const c = new AwsConnector({
      credentials: okCreds(),
      staticCredentials: okStatic(),
      secrets: { get: async () => ({}) },
    });
    expect((await c.verify(keysConn())).status).toBe("error");
  });

  it("returns error when keys mode is used but no static resolver is wired", async () => {
    const c = new AwsConnector({ credentials: okCreds(), secrets: keysSecrets });
    const r = await c.verify(keysConn());
    expect(r.status).toBe("error");
    expect(r.message).toMatch(/not supported/i);
  });
});
