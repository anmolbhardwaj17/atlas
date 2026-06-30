import { describe, it, expect } from "vitest";
import { parseAwsConfig, accountFromArn } from "./config";

describe("parseAwsConfig", () => {
  it("accepts a valid role ARN + regions and normalizes/dedupes regions", () => {
    const cfg = parseAwsConfig({
      roleArn: "arn:aws:iam::123456789012:role/AtlasReadOnly",
      regions: ["US-EAST-1", "us-east-1", "eu-west-1"],
    });
    expect(cfg.roleArn).toBe("arn:aws:iam::123456789012:role/AtlasReadOnly");
    expect(cfg.regions).toEqual(["us-east-1", "eu-west-1"]);
  });

  it("rejects a missing/invalid role ARN", () => {
    expect(() => parseAwsConfig({ regions: ["us-east-1"] })).toThrow(/role ARN/);
    expect(() => parseAwsConfig({ roleArn: "not-an-arn", regions: ["us-east-1"] })).toThrow(
      /role ARN/,
    );
    expect(() =>
      parseAwsConfig({ roleArn: "arn:aws:iam::123:role/x", regions: ["us-east-1"] }),
    ).toThrow(/role ARN/);
  });

  it("rejects missing/empty regions", () => {
    const arn = "arn:aws:iam::123456789012:role/AtlasReadOnly";
    expect(() => parseAwsConfig({ roleArn: arn })).toThrow(/region/);
    expect(() => parseAwsConfig({ roleArn: arn, regions: [] })).toThrow(/region/);
    expect(() => parseAwsConfig({ roleArn: arn, regions: ["", "  "] })).toThrow(/region/);
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
