import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  StsCredentialProvider,
  StsStaticCredentialResolver,
  AssumeRoleError,
  buildSessionName,
  assumeRoleMessage,
  staticCredsMessage,
  refreshingCredentials,
  type AwsTempCredentials,
} from "./credentials";

const stsMock = mockClient(STSClient);

describe("StsCredentialProvider", () => {
  beforeEach(() => stsMock.reset());

  it("returns creds and parses the account id from the assumed-role ARN", async () => {
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: "AKIA",
        SecretAccessKey: "secret",
        SessionToken: "token",
        Expiration: new Date("2026-07-01T01:00:00.000Z"),
      },
      AssumedRoleUser: {
        AssumedRoleId: "AROA:atlas-verify",
        Arn: "arn:aws:sts::123456789012:assumed-role/AtlasReadOnly/atlas-verify",
      },
    });

    const provider = new StsCredentialProvider(new STSClient({ region: "us-east-1" }));
    const out = await provider.assumeRole({
      roleArn: "arn:aws:iam::123456789012:role/AtlasReadOnly",
      externalId: "ext-1",
      sessionName: "atlas-verify-conn-1",
    });

    expect(out.accountId).toBe("123456789012");
    expect(out.credentials.accessKeyId).toBe("AKIA");
    expect(out.credentials.sessionToken).toBe("token");
    expect(out.credentials.expiration).toBe("2026-07-01T01:00:00.000Z");

    const calls = stsMock.commandCalls(AssumeRoleCommand);
    expect(calls.length).toBe(1);
    const call = calls[0];
    if (!call) throw new Error("expected one AssumeRole call");
    expect(call.args[0].input.ExternalId).toBe("ext-1");
    expect(call.args[0].input.RoleSessionName).toBe("atlas-verify-conn-1");
  });

  it("falls back to the role ARN account when AssumedRoleUser is absent", async () => {
    stsMock.on(AssumeRoleCommand).resolves({
      Credentials: {
        AccessKeyId: "A",
        SecretAccessKey: "S",
        SessionToken: "T",
        Expiration: new Date("2026-07-01T01:00:00.000Z"),
      },
    });
    const provider = new StsCredentialProvider(new STSClient({ region: "us-east-1" }));
    const out = await provider.assumeRole({
      roleArn: "arn:aws:iam::999988887777:role/AtlasReadOnly",
      externalId: "ext",
      sessionName: "s",
    });
    expect(out.accountId).toBe("999988887777");
  });

  it("wraps an AccessDenied into an actionable AssumeRoleError", async () => {
    stsMock
      .on(AssumeRoleCommand)
      .rejects(Object.assign(new Error("denied"), { name: "AccessDenied" }));
    const provider = new StsCredentialProvider(new STSClient({ region: "us-east-1" }));
    await expect(
      provider.assumeRole({
        roleArn: "arn:aws:iam::123456789012:role/X",
        externalId: "e",
        sessionName: "s",
      }),
    ).rejects.toBeInstanceOf(AssumeRoleError);
  });

  it("errors when STS returns no credentials", async () => {
    stsMock.on(AssumeRoleCommand).resolves({});
    const provider = new StsCredentialProvider(new STSClient({ region: "us-east-1" }));
    await expect(
      provider.assumeRole({
        roleArn: "arn:aws:iam::123456789012:role/X",
        externalId: "e",
        sessionName: "s",
      }),
    ).rejects.toThrow(/no credentials/i);
  });
});

describe("StsStaticCredentialResolver", () => {
  beforeEach(() => stsMock.reset());

  it("validates static keys via GetCallerIdentity and returns account id + keys (no session token)", async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({
      Account: "123456789012",
      Arn: "arn:aws:iam::123456789012:user/atlas-readonly",
    });
    const resolver = new StsStaticCredentialResolver();
    const out = await resolver.resolve({ accessKeyId: "AKIA_X", secretAccessKey: "sekret" });
    expect(out.accountId).toBe("123456789012");
    expect(out.credentials.accessKeyId).toBe("AKIA_X");
    expect(out.credentials.secretAccessKey).toBe("sekret");
    expect(out.credentials.sessionToken).toBeUndefined();
    expect(out.credentials.expiration).toBeNull();
  });

  it("wraps rejected keys into an actionable AssumeRoleError", async () => {
    stsMock
      .on(GetCallerIdentityCommand)
      .rejects(Object.assign(new Error("bad"), { name: "InvalidClientTokenId" }));
    const resolver = new StsStaticCredentialResolver();
    await expect(
      resolver.resolve({ accessKeyId: "bad", secretAccessKey: "bad" }),
    ).rejects.toBeInstanceOf(AssumeRoleError);
  });

  it("errors when no account id comes back", async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({});
    const resolver = new StsStaticCredentialResolver();
    await expect(resolver.resolve({ accessKeyId: "A", secretAccessKey: "S" })).rejects.toThrow(
      /account id/i,
    );
  });
});

describe("staticCredsMessage", () => {
  it("maps key-rejection errors to actionable text", () => {
    expect(staticCredsMessage({ name: "InvalidClientTokenId" })).toMatch(/rejected|access keys/i);
    expect(staticCredsMessage({ name: "SignatureDoesNotMatch" })).toMatch(/rejected|access keys/i);
    expect(staticCredsMessage({ name: "AccessDenied" })).toMatch(/GetCallerIdentity|read-only/i);
    expect(staticCredsMessage({ message: "boom" })).toMatch(/boom/);
  });
});

describe("buildSessionName", () => {
  it("sanitizes illegal chars and caps at 64", () => {
    expect(buildSessionName("atlas-sync", "abc/def 123")).toBe("atlas-sync-abc-def-123");
    expect(buildSessionName("atlas-sync", "x".repeat(100)).length).toBe(64);
  });
});

describe("assumeRoleMessage", () => {
  it("maps known STS error names to actionable text", () => {
    expect(assumeRoleMessage({ name: "AccessDenied" })).toMatch(/trust policy|External ID/i);
    expect(assumeRoleMessage({ name: "ExpiredToken" })).toMatch(/Atlas-side/i);
    expect(assumeRoleMessage({ name: "ValidationError" })).toMatch(/invalid|malformed/i);
    expect(assumeRoleMessage({ message: "boom" })).toMatch(/boom/);
  });
});

describe("refreshingCredentials (CX1)", () => {
  const creds = (accessKeyId: string, expiration: string | null): AwsTempCredentials => ({
    accessKeyId,
    secretAccessKey: "s",
    sessionToken: "t",
    expiration,
  });

  it("serves the seed without a refresh while it's comfortably unexpired", async () => {
    let refreshes = 0;
    const provider = refreshingCredentials(
      async () => {
        refreshes++;
        return creds("REFRESHED", "2026-07-01T02:00:00.000Z");
      },
      creds("SEED", "2026-07-01T02:00:00.000Z"),
      { now: () => Date.parse("2026-07-01T00:00:00.000Z") },
    );
    expect((await provider()).accessKeyId).toBe("SEED");
    expect((await provider()).accessKeyId).toBe("SEED");
    expect(refreshes).toBe(0);
    expect((await provider()).expiration).toEqual(new Date("2026-07-01T02:00:00.000Z"));
  });

  it("re-assumes once the seed is within the refresh window, then serves fresh creds", async () => {
    let refreshes = 0;
    const provider = refreshingCredentials(
      async () => {
        refreshes++;
        return creds("REFRESHED", "2026-07-01T03:00:00.000Z");
      },
      creds("SEED", "2026-07-01T00:04:00.000Z"), // expires in 4 min → inside the 5-min window
      { now: () => Date.parse("2026-07-01T00:00:00.000Z") },
    );
    expect((await provider()).accessKeyId).toBe("REFRESHED");
    expect(refreshes).toBe(1);
  });

  it("never refreshes static keys (null expiry)", async () => {
    let refreshes = 0;
    const provider = refreshingCredentials(
      async () => {
        refreshes++;
        return creds("REFRESHED", null);
      },
      creds("STATIC", null),
    );
    expect((await provider()).accessKeyId).toBe("STATIC");
    expect((await provider()).accessKeyId).toBe("STATIC");
    expect((await provider()).expiration).toBeUndefined();
    expect(refreshes).toBe(0);
  });

  it("shares a single in-flight refresh across concurrent callers", async () => {
    let refreshes = 0;
    const provider = refreshingCredentials(
      async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 5));
        return creds("REFRESHED", "2026-07-01T03:00:00.000Z");
      },
      undefined, // no seed → first call must refresh
      { now: () => Date.parse("2026-07-01T00:00:00.000Z") },
    );
    const [a, b] = await Promise.all([provider(), provider()]);
    expect(a.accessKeyId).toBe("REFRESHED");
    expect(b.accessKeyId).toBe("REFRESHED");
    expect(refreshes).toBe(1);
  });
});
