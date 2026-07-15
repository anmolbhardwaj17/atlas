import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySlackSignature } from "./slack-verify";

const SECRET = "8f742c4d0e0a1b2c3d4e5f6a7b8c9d0e";

/** Build a valid `X-Slack-Signature` the way Slack does, for a given body + timestamp. */
function sign(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

describe("verifySlackSignature", () => {
  const now = 1_700_000_000;
  const ts = String(now);
  const body = "command=/atlas&text=what+depends+on+orders-db&team_id=T123";

  it("accepts a correctly-signed, fresh request", () => {
    const r = verifySlackSignature({
      signingSecret: SECRET,
      timestamp: ts,
      rawBody: Buffer.from(body),
      signature: sign(SECRET, ts, body),
      nowSec: now,
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a tampered body (signature no longer matches)", () => {
    const r = verifySlackSignature({
      signingSecret: SECRET,
      timestamp: ts,
      rawBody: Buffer.from(body + "&injected=1"),
      signature: sign(SECRET, ts, body),
      nowSec: now,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/mismatch/);
  });

  it("rejects a stale timestamp even if the signature is valid (replay guard)", () => {
    const oldTs = String(now - 600); // 10 min old
    const r = verifySlackSignature({
      signingSecret: SECRET,
      timestamp: oldTs,
      rawBody: Buffer.from(body),
      signature: sign(SECRET, oldTs, body),
      nowSec: now,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/stale|replay/);
  });

  it("rejects a request signed with the wrong secret", () => {
    const r = verifySlackSignature({
      signingSecret: SECRET,
      timestamp: ts,
      rawBody: Buffer.from(body),
      signature: sign("wrong-secret", ts, body),
      nowSec: now,
    });
    expect(r.valid).toBe(false);
  });

  it("rejects when headers are missing", () => {
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: undefined,
        rawBody: Buffer.from(body),
        signature: undefined,
        nowSec: now,
      }).valid,
    ).toBe(false);
  });

  it("rejects when no signing secret is configured (fail closed)", () => {
    const r = verifySlackSignature({
      signingSecret: "",
      timestamp: ts,
      rawBody: Buffer.from(body),
      signature: sign(SECRET, ts, body),
      nowSec: now,
    });
    expect(r.valid).toBe(false);
  });
});
