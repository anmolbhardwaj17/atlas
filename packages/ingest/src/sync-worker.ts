import type { Connection, Connector } from "@atlas/connector-sdk";
import { runStagedSync, type RunnerDeps, type SyncRunRecord } from "./sync-runner";
import type { Job, JobQueue } from "./queue";

/** The staged-sync queue (docs/02 §5.1). The API/scheduler enqueue here; workers run
 *  the staged sync. Finer per-stage queues (infer/index) arrive with G1/search. */
export const SYNC_QUEUE = "sync";

export interface SyncJobData {
  orgId: string;
  connectionId: string;
  runId: string;
  type?: "full" | "incremental";
}

/** Deterministic idempotency key (docs/02 §5.3): one job per (org, connection, run). */
export function syncJobId(data: SyncJobData): string {
  return `sync:${data.orgId}:${data.connectionId}:${data.runId}`;
}

export interface SyncWorkerDeps extends RunnerDeps {
  resolveConnector: (provider: string) => Connector | undefined;
  loadConnection: (orgId: string, connectionId: string) => Promise<Connection | null>;
}

/** Build the handler that runs one sync job: load connection → resolve connector →
 *  runStagedSync. Errors propagate so the queue can retry (BullMQ) per its policy. */
export function createSyncHandler(deps: SyncWorkerDeps): (job: Job<SyncJobData>) => Promise<void> {
  return async (job) => {
    const { orgId, connectionId, runId, type = "full" } = job.data;
    const connection = await deps.loadConnection(orgId, connectionId);
    if (!connection) throw new Error(`connection ${connectionId} not found`);
    const connector = deps.resolveConnector(connection.provider);
    if (!connector) throw new Error(`no connector for provider "${connection.provider}"`);
    const run: SyncRunRecord = { id: runId, orgId, connectionId, type };
    await runStagedSync(deps, connector, connection, run);
  };
}

export function registerSyncWorker(queue: JobQueue, deps: SyncWorkerDeps): void {
  queue.process<SyncJobData>(SYNC_QUEUE, createSyncHandler(deps));
}

export async function enqueueSync(queue: JobQueue, data: SyncJobData): Promise<void> {
  await queue.enqueue(SYNC_QUEUE, data, { jobId: syncJobId(data) });
}
