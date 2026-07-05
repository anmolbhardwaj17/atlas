import { describe, it, expect } from "vitest";
import { parseAwsConfig, accountFromArn } from "./config";

describe("parseAwsConfig", () => {
  it("accepts a valid role ARN + regions (role mode) and normalizes/dedupes regions", () => {
    const cfg = parseAwsConfig({
      roleArn: "arn:aws:iam::123456789012:role/AtlasReadOnly",
      regions: ["US-EAST-1", "us-east-1", "eu-west-1"],
    });
    expect(cfg.authMode).toBe("role");
    expect(cfg.roleArn).toBe("arn:aws:iam::123456789012:role/AtlasReadOnly");
    expect(cfg.regions).toEqual(["us-east-1", "eu-west-1"]);
  });

  it("accepts regions with no roleArn as keys mode (static access keys)", () => {
    const cfg = parseAwsConfig({ regions: ["us-east-1"] });
    expect(cfg.authMode).toBe("keys");
    expect(cfg.roleArn).toBeUndefined();
    expect(cfg.regions).toEqual(["us-east-1"]);
    // An explicit authMode:'keys' forces keys mode even if a (stale) roleArn is present.
    expect(parseAwsConfig({ authMode: "keys", regions: ["eu-west-1"] }).authMode).toBe("keys");
  });

  it("rejects an invalid role ARN when one is supplied (role mode)", () => {
    expect(() => parseAwsConfig({ roleArn: "not-an-arn", regions: ["us-east-1"] })).toThrow(
      /role ARN/,
    );
    expect(() =>
      parseAwsConfig({ roleArn: "arn:aws:iam::123:role/x", regions: ["us-east-1"] }),
    ).toThrow(/role ARN/);
  });

  it("rejects missing/empty regions in either mode", () => {
    const arn = "arn:aws:iam::123456789012:role/AtlasReadOnly";
    expect(() => parseAwsConfig({ roleArn: arn })).toThrow(/region/);
    expect(() => parseAwsConfig({ roleArn: arn, regions: [] })).toThrow(/region/);
    expect(() => parseAwsConfig({ regions: ["", "  "] })).toThrow(/region/);
  });
});

describe("accountFromArn", () => {
  it("extracts the 12-digit account from an ARN", () => {
    expect(accountFromArn("arn:aws:sts::123456789012:assumed-role/Atlas/sess")).toBe(
      "123456789012",
    );
    expect(accountFromArn("arn:aws:iam::123456789012:role/Atlas")).toBe("123456789012");
  });
  it("returns null when no account is present", () => {
    expect(accountFromArn("arn:aws:iam::nope:role/Atlas")).toBeNull();
    expect(accountFromArn("garbage")).toBeNull();
  });
});
