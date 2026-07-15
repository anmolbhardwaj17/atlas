import { describe, it, expect, beforeAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  SupabaseStorageSnapshotStore,
  createServiceClient,
  ensureBucket,
} from "./supabase-storage";

/**
 * F2.7: round-trips a snapshot through real Supabase Storage. Env-gated on
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-only key). Skipped in CI (no
 * Storage creds there); runs locally against the project bucket.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const suite = url && key ? describe : describe.skip;
const BUCKET = "atlas-raw-snapshots-test";

suite(
  "SupabaseStorageSnapshotStore",
  () => {
    let store: SupabaseStorageSnapshotStore;

    beforeAll(async () => {
      const client = createServiceClient(url as string, key as string);
      await ensureBucket(client, BUCKET);
      store = new SupabaseStorageSnapshotStore(client, BUCKET);
    });

    it("put then get round-trips the payload", async () => {
      const orgId = randomUUID();
      const payload = JSON.stringify({ hello: "world", n: 42 });
      const hash = createHash("sha256").update(payload).digest("hex");

      const ref = await store.put(orgId, hash, payload);
      expect(ref).toBe(`${BUCKET}/${orgId}/${hash}.json`);

      const got = await store.get(ref);
      expect(got).toBe(payload);
    });

    it("returns null for a missing object", async () => {
      expect(await store.get(`${BUCKET}/${randomUUID()}/missing.json`)).toBeNull();
    });

    it("delete removes specific objects by ref (disconnect path)", async () => {
      const orgId = randomUUID();
      const ref = await store.put(orgId, "h1", '{"a":1}');
      expect(await store.get(ref)).not.toBeNull();
      await store.delete([ref]);
      expect(await store.get(ref)).toBeNull();
    });

    it("deleteByOrg erases every object under the org prefix (org-delete path)", async () => {
      const orgId = randomUUID();
      const refA = await store.put(orgId, "ha", '{"a":1}');
      const refB = await store.put(orgId, "hb", '{"b":2}');
      const other = randomUUID();
      const refOther = await store.put(other, "hc", '{"c":3}');

      await store.deleteByOrg(orgId);

      expect(await store.get(refA)).toBeNull();
      expect(await store.get(refB)).toBeNull();
      expect(await store.get(refOther)).not.toBeNull(); // another org untouched
    });
  },
  30000,
);
