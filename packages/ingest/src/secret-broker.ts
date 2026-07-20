import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { withOrgScope, type Db } from "@atlas/db";
import type { SecretAccessor } from "@atlas/connector-sdk";

/** Parse a 32-byte AES key from 64-hex or base64. */
function parseKey(raw: string): Buffer {
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("SECRET_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64).");
  }
  return buf;
}

/** A stable, NON-secret id for a key = first 16 hex of sha256(key). Reveals nothing usable about the
 *  key, but lets a row record which key encrypted it so rotation can decrypt with the right one. */
function keyId(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

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
interface SecretRow {
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_id: string | null;
}

export class DbSecretBroker implements SecretBroker {
  /** The key that encrypts NEW writes (its id is stamped on each row). */
  private readonly primaryId: string;
  /** All keys (primary + retired) by id, for decrypting a tagged row. */
  private readonly byId = new Map<string, Buffer>();
  /** Every key, for the try-all fallback on a legacy (NULL key_id) or unknown-id row. */
  private readonly all: Buffer[] = [];

  constructor(
    private readonly db: Db,
    encryptionKey: string,
    retiredKeys: readonly string[] = [],
  ) {
    const primary = parseKey(encryptionKey);
    this.primaryId = keyId(primary);
    this.byId.set(this.primaryId, primary);
    this.all.push(primary);
    // Retired keys decrypt existing rows during/after a rotation; they never encrypt new writes.
    for (const raw of retiredKeys) {
      const k = parseKey(raw);
      const id = keyId(k);
      if (!this.byId.has(id)) {
        this.byId.set(id, k);
        this.all.push(k);
      }
    }
  }

  async put(orgId: string, material: Record<string, string>): Promise<string> {
    const enc = this.encrypt(material);
    const id = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO connection_secrets (org_id, ciphertext, iv, auth_tag, key_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, enc.ciphertext, enc.iv, enc.tag, this.primaryId],
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
      const { rows } = await c.query<SecretRow>(
        `SELECT ciphertext, iv, auth_tag, key_id FROM connection_secrets WHERE id = $1`,
        [parsed.id],
      );
      return rows[0];
    });
    return row ? (this.decryptRow(row) ?? {}) : {};
  }

  async delete(secretRef: string): Promise<void> {
    const parsed = parseDbRef(secretRef);
    if (!parsed) return;
    await withOrgScope(this.db, parsed.orgId, (c) =>
      c.query(`DELETE FROM connection_secrets WHERE id = $1`, [parsed.id]),
    );
  }

  /**
   * Re-encrypt an org's secrets that aren't already on the primary key ONTO the primary key (key
   * rotation, compliance close-out). Run after deploying a new SECRET_ENCRYPTION_KEY (old key moved to
   * retired) so the retired key can then be dropped. Idempotent; returns the number of rows rewrapped.
   * A row that no configured key can decrypt is skipped (never silently lost).
   */
  async rewrap(orgId: string): Promise<number> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<SecretRow & { id: string }>(
        `SELECT id, ciphertext, iv, auth_tag, key_id FROM connection_secrets
          WHERE key_id IS DISTINCT FROM $1`,
        [this.primaryId],
      );
      let n = 0;
      for (const row of rows) {
        const material = this.decryptRow(row);
        if (!material) continue; // undecryptable with any configured key — leave it, don't lose it
        const enc = this.encrypt(material);
        await c.query(
          `UPDATE connection_secrets SET ciphertext = $2, iv = $3, auth_tag = $4, key_id = $5 WHERE id = $1`,
          [row.id, enc.ciphertext, enc.iv, enc.tag, this.primaryId],
        );
        n++;
      }
      return n;
    });
  }

  private encrypt(material: Record<string, string>): {
    ciphertext: string;
    iv: string;
    tag: string;
  } {
    const iv = randomBytes(12);
    const key = this.byId.get(this.primaryId) as Buffer;
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ct = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(material), "utf8")),
      cipher.final(),
    ]);
    return {
      ciphertext: ct.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  /** Decrypt a row: use its tagged key when known, else try every configured key (GCM's auth tag
   *  makes trying safe — a wrong key fails to authenticate). Returns null (fail-closed) if none work. */
  private decryptRow(row: SecretRow): Record<string, string> | null {
    const tagged = row.key_id ? this.byId.get(row.key_id) : undefined;
    const candidates = tagged ? [tagged] : this.all;
    for (const key of candidates) {
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"));
        decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
        const pt = Buffer.concat([
          decipher.update(Buffer.from(row.ciphertext, "base64")),
          decipher.final(),
        ]);
        return JSON.parse(pt.toString("utf8")) as Record<string, string>;
      } catch {
        /* wrong key or tampered — try the next candidate */
      }
    }
    return null;
  }
}

/** Parse a `db:<orgId>:<uuid>` ref (both are UUIDs). Returns null for any other shape. */
function parseDbRef(ref: string): { orgId: string; id: string } | null {
  const m = /^db:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(ref);
  return m && m[1] && m[2] ? { orgId: m[1], id: m[2] } : null;
}
