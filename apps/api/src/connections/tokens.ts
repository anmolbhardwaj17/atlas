/** DI token for the Secrets Broker (docs/13 §7). */
export const SECRET_BROKER = Symbol("ATLAS_SECRET_BROKER");

/** DI token for the sync JobQueue (docs/02 §5); enqueue-on-verify uses it. */
export const JOB_QUEUE = Symbol("ATLAS_JOB_QUEUE");
