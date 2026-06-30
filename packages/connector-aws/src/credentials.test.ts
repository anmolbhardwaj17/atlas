import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  StsCredentialProvider,
  AssumeRoleError,
  buildSessionName,
  assumeRoleMessage,
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
