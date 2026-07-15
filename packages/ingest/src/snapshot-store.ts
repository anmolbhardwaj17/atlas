/**
 * Raw-snapshot blob store (docs/04 §5.4, P4). The verbatim provider payload lives
 * here; `raw_snapshots.storage_ref` points at it. F2.7 adds a Supabase Storage impl;
 * for tests/dev this in-memory store is enough (the DB still records ref + hash).
 */
export interface SnapshotStore {
  /** Persist a payload, returning the storage_ref recorded on raw_snapshots. */
  put(orgId: string, contentHash: string, payload: string): Promise<string>;
  get(storageRef: string): Promise<string | null>;
  /** Remove specific snapshot objects by their storage_ref — used on connection disconnect so a
   *  removed source leaves no raw payloads behind (the DB rows are deleted separately). */
  delete(storageRefs: string[]): Promise<void>;
  /** Remove EVERY snapshot for an org (objects are content-addressed under an `<orgId>/` prefix) —
   *  used on org deletion so "delete my org" actually erases the raw blobs, not just the DB rows. */
  deleteByOrg(orgId: string): Promise<void>;
}

export class InMemorySnapshotStore implements SnapshotStore {
  private readonly blobs = new Map<string, string>();

  async put(orgId: string, contentHash: string, payload: string): Promise<string> {
    const ref = `mem://${orgId}/${contentHash}`;
    this.blobs.set(ref, payload);
    return ref;
  }

  async get(storageRef: string): Promise<string | null> {
    return this.blobs.get(storageRef) ?? null;
  }

  async delete(storageRefs: string[]): Promise<void> {
    for (const ref of storageRefs) this.blobs.delete(ref);
  }

  async deleteByOrg(orgId: string): Promise<void> {
    const prefix = `mem://${orgId}/`;
    for (const key of [...this.blobs.keys()]) if (key.startsWith(prefix)) this.blobs.delete(key);
  }
}
