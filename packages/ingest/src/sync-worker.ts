import type { Connection, Connector } from "@atlas/connector-sdk";
import { runInference, ALL_RULES } from "@atlas/inference";
import { runStagedSync, type RunnerDeps, type SyncRunRecord } from "./sync-runner";
import { runOsvEnrichment } from "./osv-enrichment";
import { silentLogger } from "./runtime";
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
 *  runStagedSync → **infer stage** (docs/05 §6.1: inference runs after nodes/signals are
 *  persisted). Sync errors propagate so the queue can retry; an inference error is logged
 *  but does NOT fail the job — the next sync's infer pass converges it (P7). */
export function createSyncHandler(deps: SyncWorkerDeps): (job: Job<SyncJobData>) => Promise<void> {
  const logger = deps.logger ?? silentLogger;
  return async (job) => {
    const { orgId, connectionId, runId, type = "full" } = job.data;
    const connection = await deps.loadConnection(orgId, connectionId);
    if (!connection) throw new Error(`connection ${connectionId} not found`);
    const connector = deps.resolveConnector(connection.provider);
    if (!connector) throw new Error(`no connector for provider "${connection.provider}"`);
    const run: SyncRunRecord = { id: runId, orgId, connectionId, type };
    const result = await runStagedSync(deps, connector, connection, run);

    // Enrich stage: query OSV.dev for vulnerabilities affecting the just-persisted packages.
    // Best-effort (docs/plans/security-vulnerabilities.md) — a transient OSV outage or a graph
    // with no packages must never fail the sync.
    if (result.status !== "failed") {
      try {
        const osv = await runOsvEnrichment({ db: deps.db }, orgId);
        logger.info(
          `osv after sync ${runId}: scanned ${osv.packagesScanned} pkgs, ` +
            `found ${osv.vulnerabilitiesFound} vulns (${osv.affectsEdges} affects edges)`,
        );
      } catch (err) {
        logger.error(`osv enrichment after sync ${runId} failed: ${(err as Error).message}`);
      }
    }

    // Infer stage: derive cross-source edges from the just-persisted nodes/signals.
    if (result.status !== "failed") {
      try {
        await runInference({ db: deps.db }, orgId, ALL_RULES);
      } catch (err) {
        logger.error(`inference after sync ${runId} failed: ${(err as Error).message}`);
      }
    }
  };
}

export function registerSyncWorker(queue: JobQueue, deps: SyncWorkerDeps): void {
  queue.process<SyncJobData>(SYNC_QUEUE, createSyncHandler(deps));
}

export async function enqueueSync(queue: JobQueue, data: SyncJobData): Promise<void> {
  await queue.enqueue(SYNC_QUEUE, data, { jobId: syncJobId(data) });
}
