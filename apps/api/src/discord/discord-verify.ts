/**
 * Discord interaction-signature verification (the Discord analog of slack-verify). Discord signs
 * every interaction POST with **Ed25519** over `timestamp + rawBody`; the `X-Signature-Ed25519`
 * header is the authentication (there is no Atlas session), so this runs BEFORE anything is trusted.
 *
 * Uses native Node crypto — no `tweetnacl`/`discord.js` dependency. Discord hands out a 32-byte raw
 * public key (hex); we wrap it in the fixed Ed25519 SPKI DER prefix to build a KeyObject, then
 * `crypto.verify(null, …)`. The failure `reason` is for server logs only — never echo it back.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

export interface DiscordVerifyInput {
  /** The app's Ed25519 public key (hex), from the Discord Developer Portal. */
  publicKey: string;
  /** `X-Signature-Timestamp` header. */
  timestamp: string | undefined;
  /** The EXACT bytes Discord sent (the signature is over timestamp + these bytes). */
  rawBody: Buffer;
  /** `X-Signature-Ed25519` header (hex). */
  signature: string | undefined;
}

export interface DiscordVerifyResult {
  valid: boolean;
  reason?: string;
}

// DER SPKI header for an Ed25519 public key (RFC 8410): 12 bytes, then the 32 raw key bytes.
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function publicKeyFromHex(hex: string): KeyObject {
  const raw = Buffer.from(hex, "hex");
  if (raw.length !== 32) throw new Error("ed25519 public key must be 32 bytes");
  return createPublicKey({
    key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export function verifyDiscordSignature(input: DiscordVerifyInput): DiscordVerifyResult {
  const { publicKey, timestamp, rawBody, signature } = input;
  if (!publicKey) return { valid: false, reason: "no public key configured" };
  if (!timestamp || !signature) return { valid: false, reason: "missing signature headers" };

  let key: KeyObject;
  try {
    key = publicKeyFromHex(publicKey);
  } catch {
    return { valid: false, reason: "malformed public key" };
  }

  const sig = Buffer.from(signature, "hex");
  if (sig.length !== 64) return { valid: false, reason: "malformed signature" };

  const message = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
  let ok = false;
  try {
    ok = cryptoVerify(null, message, key, sig);
  } catch {
    return { valid: false, reason: "verify error" };
  }
  return ok ? { valid: true } : { valid: false, reason: "signature mismatch" };
}
