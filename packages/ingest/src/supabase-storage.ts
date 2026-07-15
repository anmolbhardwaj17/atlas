import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SnapshotStore } from "./snapshot-store";

/** The private bucket holding verbatim raw connector payloads (P4 click-through). Shared by the
 *  writer (sync worker) and the deleters (disconnect / org-delete) so they agree on the location. */
export const RAW_SNAPSHOT_BUCKET = "atlas-raw-snapshots";

/**
 * Supabase Storage-backed SnapshotStore (docs/04 §5.4, docs/13). Stores the verbatim
 * provider payload in a PRIVATE bucket, content-addressed (`<orgId>/<hash>.json`) and
 * idempotent (`upsert`), so identical payloads dedupe and re-runs are safe. Uses the
 * service-role key (server-only — bypasses Storage RLS; never ships to the client).
 *
 * `raw_snapshots.storage_ref` holds `<bucket>/<path>` so the object is resolvable
 * later (click-through to raw, P4).
 */
export class SupabaseStorageSnapshotStore implements SnapshotStore {
  private ensured = false;

  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  /** Create the private bucket on first write if it doesn't exist (idempotent, once per process). */
  private async ensure(): Promise<void> {
    if (this.ensured) return;
    await ensureBucket(this.client, this.bucket);
    this.ensured = true;
  }

  async put(orgId: string, contentHash: string, payload: string): Promise<string> {
    await this.ensure();
    const path = `${orgId}/${contentHash}.json`;
    const { error } = await this.client.storage.from(this.bucket).upload(path, payload, {
      contentType: "application/json",
      upsert: true,
    });
    if (error) throw new Error(`snapshot upload failed: ${error.message}`);
    return `${this.bucket}/${path}`;
  }

  async get(storageRef: string): Promise<string | null> {
    const path = this.pathOf(storageRef);
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) return null;
    return data.text();
  }

  async delete(storageRefs: string[]): Promise<void> {
    if (storageRefs.length === 0) return;
    const paths = storageRefs.map((r) => this.pathOf(r));
    const { error } = await this.client.storage.from(this.bucket).remove(paths);
    if (error) throw new Error(`snapshot delete failed: ${error.message}`);
  }

  async deleteByOrg(orgId: string): Promise<void> {
    // Objects live under `<orgId>/`; Storage `remove` takes explicit paths, so list-then-remove in
    // pages until the prefix is empty (each remove shrinks the next listing — bounded loop).
    for (let page = 0; page < 1000; page++) {
      const { data, error } = await this.client.storage
        .from(this.bucket)
        .list(orgId, { limit: 1000 });
      if (error) throw new Error(`snapshot list failed: ${error.message}`);
      if (!data || data.length === 0) return;
      const paths = data.map((o) => `${orgId}/${o.name}`);
      const { error: rmErr } = await this.client.storage.from(this.bucket).remove(paths);
      if (rmErr) throw new Error(`snapshot delete failed: ${rmErr.message}`);
      if (data.length < 1000) return;
    }
  }

  /** storage_ref (`<bucket>/<path>`) → object path within the bucket. */
  private pathOf(storageRef: string): string {
    const prefix = `${this.bucket}/`;
    return storageRef.startsWith(prefix) ? storageRef.slice(prefix.length) : storageRef;
  }
}

/** Build a server-side Supabase client (no session persistence). */
export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
}

/**
 * Idempotently ensure a bucket exists (safe to call repeatedly). Private by default (raw
 * snapshots); pass `{ public: true }` for buckets whose objects are served by public URL
 * (e.g. org logos, which render in the browser without a signed request).
 */
export async function ensureBucket(
  client: SupabaseClient,
  bucket: string,
  opts: { public?: boolean } = {},
): Promise<void> {
  const { error } = await client.storage.createBucket(bucket, { public: opts.public ?? false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`createBucket(${bucket}) failed: ${error.message}`);
  }
}
