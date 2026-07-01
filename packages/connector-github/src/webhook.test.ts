import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature, parseWebhookEvent } from "./webhook";

const SECRET = "s3cr3t";
const sign = (body: string): string =>
  "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");

describe("verifyWebhookSignature", () => {
  it("accepts a correct signature and rejects tampering (GHR-8)", () => {
    const body = JSON.stringify({ action: "opened" });
    expect(verifyWebhookSignature(SECRET, body, sign(body))).toBe(true);
    expect(verifyWebhookSignature(SECRET, body + "x", sign(body))).toBe(false);
    expect(verifyWebhookSignature("wrong", body, sign(body))).toBe(false);
  });
  it("rejects missing/malformed headers without throwing", () => {
    expect(verifyWebhookSignature(SECRET, "b", undefined)).toBe(false);
    expect(verifyWebhookSignature(SECRET, "b", "md5=abc")).toBe(false);
    expect(verifyWebhookSignature(SECRET, "b", "sha256=short")).toBe(false);
  });
});

describe("parseWebhookEvent", () => {
  const repo = { name: "checkout-svc", owner: { login: "acme" } };
  it("maps known events and extracts the repo", () => {
    expect(parseWebhookEvent("push", { repository: repo })).toEqual({
      kind: "push",
      repo: { owner: "acme", repo: "checkout-svc" },
    });
    expect(parseWebhookEvent("pull_request", { action: "closed", repository: repo })).toEqual({
      kind: "pull_request",
      action: "closed",
      repo: { owner: "acme", repo: "checkout-svc" },
    });
    expect(parseWebhookEvent("team", {})).toEqual({ kind: "membership" });
    expect(parseWebhookEvent("ping", {})).toEqual({ kind: "ping" });
    expect(parseWebhookEvent("star", {})).toEqual({ kind: "other" });
  });
});
