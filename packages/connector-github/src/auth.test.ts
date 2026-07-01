import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { jwtVerify, importSPKI } from "jose";
import { buildAppJwt } from "./auth";

describe("buildAppJwt", () => {
  // GitHub issues PKCS#1 keys; verify buildAppJwt handles a real RSA key end-to-end.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  it("signs a verifiable RS256 App JWT with iss=appId and a bounded lifetime", async () => {
    const now = 1_700_000_000;
    const jwt = await buildAppJwt("42", privateKey, now);
    const spki = await importSPKI(publicKey, "RS256");
    // Verify against the same fixed clock the JWT was signed with (else it looks expired).
    const { payload, protectedHeader } = await jwtVerify(jwt, spki, {
      currentDate: new Date(now * 1000),
    });

    expect(protectedHeader.alg).toBe("RS256");
    expect(payload.iss).toBe("42");
    expect(payload.iat).toBe(now - 60); // backdated for clock skew
    expect(payload.exp).toBe(now + 540); // < 10 min max
  });

  it("throws a clear error on a malformed private key", async () => {
    await expect(buildAppJwt("42", "not-a-key")).rejects.toThrow(/private key is invalid/i);
  });
});
