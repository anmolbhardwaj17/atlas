import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as edSign, type KeyObject } from "node:crypto";
import { verifyDiscordSignature } from "./discord-verify";

/** A real Ed25519 keypair; export the public key as the 32-byte raw hex Discord would give us. */
function keypair(): { publicKeyHex: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const raw = spki.subarray(spki.length - 32); // strip the 12-byte SPKI prefix
  return { publicKeyHex: raw.toString("hex"), privateKey };
}

/** Sign like Discord: Ed25519 over `timestamp + body`, hex-encoded. */
function sign(privateKey: KeyObject, timestamp: string, body: string): string {
  const msg = Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from(body)]);
  return edSign(null, msg, privateKey).toString("hex");
}

describe("verifyDiscordSignature", () => {
  const ts = "1700000000";
  const body = '{"type":2,"data":{"name":"atlas"},"guild_id":"G1"}';

  it("accepts a correctly-signed interaction", () => {
    const { publicKeyHex, privateKey } = keypair();
    const r = verifyDiscordSignature({
      publicKey: publicKeyHex,
      timestamp: ts,
      rawBody: Buffer.from(body),
      signature: sign(privateKey, ts, body),
    });
    expect(r.valid).toBe(true);
  });

  it("rejects a tampered body", () => {
    const { publicKeyHex, privateKey } = keypair();
    const r = verifyDiscordSignature({
      publicKey: publicKeyHex,
      timestamp: ts,
      rawBody: Buffer.from(body + "tampered"),
      signature: sign(privateKey, ts, body),
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/mismatch/);
  });

  it("rejects a signature from a different key", () => {
    const a = keypair();
    const b = keypair();
    const r = verifyDiscordSignature({
      publicKey: a.publicKeyHex,
      timestamp: ts,
      rawBody: Buffer.from(body),
      signature: sign(b.privateKey, ts, body),
    });
    expect(r.valid).toBe(false);
  });

  it("rejects a swapped timestamp (signature covers it)", () => {
    const { publicKeyHex, privateKey } = keypair();
    const r = verifyDiscordSignature({
      publicKey: publicKeyHex,
      timestamp: "9999999999",
      rawBody: Buffer.from(body),
      signature: sign(privateKey, ts, body),
    });
    expect(r.valid).toBe(false);
  });

  it("rejects missing headers and an unconfigured key (fail closed)", () => {
    const { publicKeyHex } = keypair();
    expect(
      verifyDiscordSignature({
        publicKey: publicKeyHex,
        timestamp: undefined,
        rawBody: Buffer.from(body),
        signature: undefined,
      }).valid,
    ).toBe(false);
    expect(
      verifyDiscordSignature({
        publicKey: "",
        timestamp: ts,
        rawBody: Buffer.from(body),
        signature: "ab".repeat(64),
      }).valid,
    ).toBe(false);
  });

  it("rejects a malformed public key without throwing", () => {
    const r = verifyDiscordSignature({
      publicKey: "not-hex-zz",
      timestamp: ts,
      rawBody: Buffer.from(body),
      signature: "ab".repeat(64),
    });
    expect(r.valid).toBe(false);
  });
});
