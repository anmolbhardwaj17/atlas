/**
 * Slack request-signature verification (docs/13 §5 ingress trust; mirrors the GitHub-webhook HMAC
 * gate). A slash-command request carries no Atlas session — the signature IS the authentication, so
 * this runs BEFORE we trust anything (team_id, text, response_url). Two checks:
 *   1. HMAC-SHA256 over `v0:{timestamp}:{rawBody}` equals the `X-Slack-Signature` header.
 *   2. The timestamp is within ±5 min (replay guard — a captured request can't be re-fired later).
 * Constant-time compare. The failure `reason` is for server logs only — never echo it to the caller.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SlackVerifyInput {
  signingSecret: string;
  /** `X-Slack-Request-Timestamp` — unix seconds, as a string. */
  timestamp: string | undefined;
  /** The EXACT bytes Slack sent (the HMAC is over the raw body, not a re-serialization). */
  rawBody: Buffer;
  /** `X-Slack-Signature` — `v0=<hex>`. */
  signature: string | undefined;
  /** Injectable clock (unix seconds) for tests. */
  nowSec?: number;
  /** Replay tolerance in seconds (Slack's own recommendation is 300). */
  toleranceSec?: number;
}

export interface SlackVerifyResult {
  valid: boolean;
  reason?: string;
}

export function verifySlackSignature(input: SlackVerifyInput): SlackVerifyResult {
  const { signingSecret, timestamp, rawBody, signature } = input;
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSec ?? 300;

  if (!signingSecret) return { valid: false, reason: "no signing secret configured" };
  if (!timestamp || !signature) return { valid: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: "malformed timestamp" };
  if (Math.abs(now - ts) > tolerance) return { valid: false, reason: "stale timestamp (replay?)" };

  const base = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;

  // Constant-time compare. timingSafeEqual throws on length mismatch, so guard first.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return { valid: false, reason: "signature length mismatch" };
  if (!timingSafeEqual(a, b)) return { valid: false, reason: "signature mismatch" };

  return { valid: true };
}
