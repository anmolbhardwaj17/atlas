import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { withOrgScope, type Db } from "@atlas/db";
import type { SecretAccessor } from "@atlas/connector-sdk";

/**
 * Secrets Broker (docs/13 §7). Stores connector credentials out of band and hands
 * back an opaque `secret_ref` (BR-CONN-1: `connections.secret_ref` is a pointer,
 * never the secret). Connectors read material at call time via `get` (it extends the
 * SDK's SecretAccessor). The production impl is AWS Secrets Manager (Phase-later);
 * this in-memory broker is for dev/tests.
 */
export interface SecretBroker extends SecretAccessor {
  /** Store credential material; returns the opaque secret_ref to persist on the connection. */
  put(orgId: string, material: Record<string, string>): Promise<string>;
  delete(secretRef: string): Promise<void>;
}

export class InMemorySecretBroker implements SecretBroker {
  private readonly store = new Map<string, Record<string, string>>();

  async put(orgId: string, material: Record<string, string>): Promise<string> {
    const ref = `mem:${orgId}:${randomUUID()}`;
    this.store.set(ref, material);
    return ref;
  }

  async get(secretRef: string): Promise<Record<string, string>> {
    return this.store.get(secretRef) ?? {};
  }

  async delete(secretRef: string): Promise<void> {
    this.store.delete(secretRef);
  }
}

/**
 * Durable, encrypted Secrets Broker (docs/13 §7). Persists credential material in
 * `connection_secrets`, AES-256-GCM encrypted at rest. The encryption key comes from env
 * (SECRET_ENCRYPTION_KEY) and is NEVER stored in the DB, so a DB compromise alone can't reveal
 * secrets. Survives restarts - so a source is connected once and syncs on demand forever (no
 * more "reconnect to refresh"). Org-scoped: the ref embeds the org (`db:<org>:<uuid>`), so both
 * put and get set `atlas.current_org` and RLS confines each row to its tenant (R8). BR-CONN-1
 * still holds - `connections.secret_ref` is only this pointer, never the secret.
 */
export class DbSecretBroker implements SecretBroker {
  private readonly key: Buffer;

  constructor(
    private readonly db: Db,
    encryptionKey: string,
  ) {
    // 32-byte key, accepted as 64-hex or base64.
    const buf = /^[0-9a-f]{64}$/i.test(encryptionKey)
      ? Buffer.from(encryptionKey, "hex")
      : Buffer.from(encryptionKey, "base64");
    if (buf.length !== 32) {
      throw new Error("SECRET_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).");
    }
    this.key = buf;
  }

  async put(orgId: string, material: Record<string, string>): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(material), "utf8")),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const id = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO connection_secrets (org_id, ciphertext, iv, auth_tag)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, ct.toString("base64"), iv.toString("base64"), tag.toString("base64")],
      );
      return rows[0]?.id;
    });
    if (!id) throw new Error("Failed to persist secret.");
    return `db:${orgId}:${id}`;
  }

  async get(secretRef: string): Promise<Record<string, string>> {
    const parsed = parseDbRef(secretRef);
    if (!parsed) return {};
    const row = await withOrgScope(this.db, parsed.orgId, async (c) => {
      const { rows } = await c.query<{ ciphertext: string; iv: string; auth_tag: string }>(
        `SELECT ciphertext, iv, auth_tag FROM connection_secrets WHERE id = $1`,
        [parsed.id],
      );
      return rows[0];
    });
    if (!row) return {};
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(row.iv, "base64"));
      decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
      const pt = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext, "base64")),
        decipher.final(),
      ]);
      return JSON.parse(pt.toString("utf8")) as Record<string, string>;
    } catch {
      return {}; // wrong key or tampered ciphertext - fail closed, never throw a secret
    }
  }

  async delete(secretRef: string): Promise<void> {
    const parsed = parseDbRef(secretRef);
    if (!parsed) return;
    await withOrgScope(this.db, parsed.orgId, (c) =>
      c.query(`DELETE FROM connection_secrets WHERE id = $1`, [parsed.id]),
    );
  }
}

/** Parse a `db:<orgId>:<uuid>` ref (both are UUIDs). Returns null for any other shape. */
function parseDbRef(ref: string): { orgId: string; id: string } | null {
  const m = /^db:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(ref);
  return m && m[1] && m[2] ? { orgId: m[1], id: m[2] } : null;
}
