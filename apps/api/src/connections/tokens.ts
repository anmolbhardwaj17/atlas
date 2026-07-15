/** DI token for the Secrets Broker (docs/13 §7). */
export const SECRET_BROKER = Symbol("ATLAS_SECRET_BROKER");

/** DI token for the sync JobQueue (docs/02 §5); enqueue-on-verify uses it. */
export const JOB_QUEUE = Symbol("ATLAS_JOB_QUEUE");

/** DI token for the raw-snapshot blob store (docs/04 §5.4). One shared instance so the sync worker
 *  (writes) and the connection/org services (delete on disconnect/org-delete) hit the same store. */
export const SNAPSHOT_STORE = Symbol("ATLAS_SNAPSHOT_STORE");
