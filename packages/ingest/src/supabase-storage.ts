import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SnapshotStore } from "./snapshot-store";

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
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async put(orgId: string, contentHash: string, payload: string): Promise<string> {
    const path = `${orgId}/${contentHash}.json`;
    const { error } = await this.client.storage.from(this.bucket).upload(path, payload, {
      contentType: "application/json",
      upsert: true,
    });
    if (error) throw new Error(`snapshot upload failed: ${error.message}`);
    return `${this.bucket}/${path}`;
  }

  async get(storageRef: string): Promise<string | null> {
    const prefix = `${this.bucket}/`;
    const path = storageRef.startsWith(prefix) ? storageRef.slice(prefix.length) : storageRef;
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) return null;
    return data.text();
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
