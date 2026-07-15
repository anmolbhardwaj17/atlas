import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Db } from "@atlas/db";
import type { SnapshotStore } from "@atlas/ingest";
import { PG_POOL } from "../core/tokens";
import { SNAPSHOT_STORE } from "./tokens";

/** Retention windows (days). Defaults match docs/13: rolling raw snapshots, a year of activity, a
 *  quarter of sync history. Overridable via env for a customer with a stricter/looser policy. */
export interface RetentionWindows {
  snapshotDays: number;
  nodeEventDays: number;
  syncRunDays: number;
  analyticsDays: number;
}

export const DEFAULT_RETENTION: RetentionWindows = {
  snapshotDays: 30,
  nodeEventDays: 365,
  syncRunDays: 90,
  analyticsDays: 365,
};

export interface RetentionResult {
  snapshots: number;
  nodeEvents: number;
  syncRuns: number;
  analytics: number;
}

/**
 * Storage-limitation retention (compliance scan S2). Runs the cross-org `app_purge_expired`
 * SECURITY DEFINER sweep — which deletes rows past each table's window across all orgs (age-based,
 * so no per-org scope) — then erases the raw-snapshot BLOBS the sweep returned (the DB row is only a
 * pointer). Idempotent: a run with nothing expired deletes nothing.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(SNAPSHOT_STORE) private readonly snapshots: SnapshotStore,
  ) {}

  async purgeExpired(windows: RetentionWindows = DEFAULT_RETENTION): Promise<RetentionResult> {
    const { rows } = await this.db.query<{
      snapshot_refs: string[] | null;
      node_events: number;
      sync_runs: number;
      analytics: number;
    }>(
      `SELECT snapshot_refs, node_events, sync_runs, analytics FROM app_purge_expired($1,$2,$3,$4)`,
      [windows.snapshotDays, windows.nodeEventDays, windows.syncRunDays, windows.analyticsDays],
    );
    const row = rows[0];
    const refs = row?.snapshot_refs ?? [];
    // Erase the aged-out blobs too (best-effort — the DB rows are already gone).
    if (refs.length > 0) {
      await this.snapshots
        .delete(refs)
        .catch((e) => this.logger.warn(`retention blob purge failed: ${String(e)}`));
    }
    return {
      snapshots: refs.length,
      nodeEvents: Number(row?.node_events ?? 0),
      syncRuns: Number(row?.sync_runs ?? 0),
      analytics: Number(row?.analytics ?? 0),
    };
  }
}
