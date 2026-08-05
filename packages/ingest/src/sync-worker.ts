import type { Connection, Connector } from "@atlas/connector-sdk";
import { runInference, ALL_RULES } from "@atlas/inference";
import { runStagedSync, type RunnerDeps, type SyncRunRecord } from "./sync-runner";
import { runOsvEnrichment } from "./osv-enrichment";
import { deriveDeployEvents } from "./deploy-events";
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

/**
 * Deterministic idempotency key (docs/02 §5.3): one job per (org, connection, run).
 *
 * Separated by `-`, NOT `:`. BullMQ rejects a custom job id containing a colon outright
 * (`Custom Id cannot contain :`) because it namespaces its own Redis keys with `:` — so a colon in
 * the id would collide with its key structure. This is still unambiguous: every component is a UUID.
 *
 * This bit us in production and nowhere else. Dev and CI leave `REDIS_URL` unset and fall back to
 * the in-memory queue (`queue.ts`), which accepts any string as an id — so the very first time this
 * ran against a real BullMQ was the first production sync, where every enqueue failed and each sync
 * died before it started. `syncJobId.test.ts` now pins the constraint so the in-memory fallback
 * can't hide it again.
 */
export function syncJobId(data: SyncJobData): string {
  return `sync-${data.orgId}-${data.connectionId}-${data.runId}`;
}

export interface SyncWorkerDeps extends RunnerDeps {
  resolveConnector: (provider: string) => Connector | undefined;
  loadConnection: (orgId: string, connectionId: string) => Promise<Connection | null>;
  /** Ran after a non-failed sync's enrich + infer stages, once the graph is fully persisted.
   *  Used to reconcile the derived-finding lifecycle (open/resolved/regressed). Best-effort. */
  onSyncComplete?: (orgId: string, connectionId: string) => Promise<void>;
  /** Observability hook: the runner's outcome for this job (succeeded/partial/failed), for metrics.
   *  Best-effort — a throw here must never affect the sync. */
  onJobResult?: (outcome: "succeeded" | "partial" | "failed") => void;
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
    try {
      deps.onJobResult?.(result.status);
    } catch {
      /* metrics must never break a sync */
    }

    // Enrich stage: query OSV.dev for vulnerabilities affecting the just-persisted packages.
    // Best-effort (docs/plans/security-vulnerabilities.md) — a transient OSV outage or a graph
    // with no packages must never fail the sync.
    if (result.status !== "failed") {
      try {
        const osv = await runOsvEnrichment({ db: deps.db }, orgId);
        logger.info(
          `osv after sync ${runId}: scanned ${osv.packagesScanned} pkgs, ` +
            `found ${osv.vulnerabilitiesFound} vulns (${osv.affectsEdges} affects edges, ` +
            `${osv.retiredAffects} retired)`,
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

    // Deploy-events stage: derive `deploy` node_events from the just-persisted runtimes (Lambda
    // LastModified) so `diagnose` can correlate "deployed at 14:02 → broke at 14:05". Best-effort;
    // idempotent, so a redeploy adds one event and unchanged functions are no-ops.
    if (result.status !== "failed") {
      try {
        const dep = await deriveDeployEvents({ db: deps.db }, orgId);
        logger.info(
          `deploy events after sync ${runId}: +${dep.inserted} (${dep.scanned} lambdas scanned)`,
        );
      } catch (err) {
        logger.error(`deploy-events after sync ${runId} failed: ${(err as Error).message}`);
      }
    }

    // Lifecycle stage: reconcile the persisted finding history now the graph is fully built, so a
    // fixed finding is recorded as resolved (and a returning one as regressed). Best-effort (P7).
    if (result.status !== "failed" && deps.onSyncComplete) {
      try {
        await deps.onSyncComplete(orgId, connectionId);
      } catch (err) {
        logger.error(`finding reconcile after sync ${runId} failed: ${(err as Error).message}`);
      }
    }

    // The sync WHOLLY failed (every scope errored — typically a provider or credential outage). Throw
    // so the queue retries with backoff: runStagedSync resets the same runId back to 'running', so the
    // retry re-runs cleanly. A `partial` sync is NOT retried — the graph was updated for the scopes
    // that worked, and the next scheduled sync fills the gaps. (The dev in-memory queue swallows this;
    // BullMQ applies attempts+backoff.)
    if (result.status === "failed") {
      throw new Error(
        `sync ${runId} failed: ${result.failedScopes.length} scope(s) errored — retrying`,
      );
    }
  };
}

export function registerSyncWorker(queue: JobQueue, deps: SyncWorkerDeps): void {
  queue.process<SyncJobData>(SYNC_QUEUE, createSyncHandler(deps));
}

export async function enqueueSync(queue: JobQueue, data: SyncJobData): Promise<void> {
  await queue.enqueue(SYNC_QUEUE, data, { jobId: syncJobId(data) });
}
