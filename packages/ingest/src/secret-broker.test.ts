import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DbSecretBroker } from "./secret-broker";

/**
 * Secrets Broker key ROTATION (compliance close-out). A new primary key encrypts new writes while
 * retired keys still decrypt existing rows; `rewrap` re-encrypts onto the primary so the old key can
 * be dropped. Env-gated (real Postgres) — skipped without TEST_DATABASE_URL + TEST_ADMIN_DATABASE_URL.
 */
const appUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const suite = appUrl && adminUrl ? describe : describe.skip;

const hexKey = (): string => randomBytes(32).toString("hex");

suite("DbSecretBroker key rotation", () => {
  let admin: Pool;
  let app: Pool;
  let orgId: string;
  const keyA = hexKey();
  const keyB = hexKey();

  const keyIdOf = async (ref: string): Promise<string | null> => {
    const id = ref.split(":")[2];
    const { rows } = await admin.query<{ key_id: string | null }>(
      "SELECT key_id FROM connection_secrets WHERE id = $1",
      [id],
    );
    return rows[0]?.key_id ?? null;
  };

  beforeAll(() => {
    admin = new Pool({ connectionString: adminUrl });
    app = new Pool({ connectionString: appUrl });
  });
  afterAll(async () => {
    await admin.end();
    await app.end();
  });
  beforeEach(async () => {
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO organizations (slug, name) VALUES ($1,'Org') RETURNING id",
      [`sec-${randomUUID().slice(0, 8)}`],
    );
    orgId = rows[0]?.id as string;
  });
  afterEach(async () => {
    await admin.query("DELETE FROM organizations WHERE id = $1", [orgId]);
  });

  it("round-trips a secret and deletes it", async () => {
    const broker = new DbSecretBroker(app, keyA);
    const ref = await broker.put(orgId, { token: "s3cr3t" });
    expect(await broker.get(ref)).toEqual({ token: "s3cr3t" });
    await broker.delete(ref);
    expect(await broker.get(ref)).toEqual({});
  });

  it("rotates: retired key still decrypts, rewrap re-keys, old key then droppable", async () => {
    // Written under key A.
    const ref = await new DbSecretBroker(app, keyA).put(orgId, { token: "abc" });
    const idA = await keyIdOf(ref);
    expect(idA).toBeTruthy();

    // Rotate: primary = B, A retired (decrypt-only). Old secret still readable; a NEW secret uses B.
    const rotating = new DbSecretBroker(app, keyB, [keyA]);
    expect(await rotating.get(ref)).toEqual({ token: "abc" }); // decrypts via retired A
    const refB = await rotating.put(orgId, { token: "xyz" });
    expect(await keyIdOf(refB)).not.toBe(idA); // new write tagged with B

    // Rewrap re-encrypts the A-row onto B; the row's key_id flips to B's.
    const rewrapped = await rotating.rewrap(orgId);
    expect(rewrapped).toBe(1); // only the old A-row needed rewrapping (refB was already B)
    expect(await keyIdOf(ref)).toBe(await keyIdOf(refB));

    // Now the retired A key can be dropped entirely and both secrets still decrypt under B alone.
    const afterDrop = new DbSecretBroker(app, keyB);
    expect(await afterDrop.get(ref)).toEqual({ token: "abc" });
    expect(await afterDrop.get(refB)).toEqual({ token: "xyz" });
  });

  it("fails closed (empty) when no configured key can decrypt", async () => {
    const ref = await new DbSecretBroker(app, keyA).put(orgId, { token: "abc" });
    // A broker holding only an unrelated key can't decrypt → returns {} (never throws the secret).
    expect(await new DbSecretBroker(app, keyB).get(ref)).toEqual({});
  });
});
