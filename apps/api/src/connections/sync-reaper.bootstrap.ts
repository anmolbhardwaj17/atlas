import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import type { Db } from "@atlas/db";
import { PG_POOL } from "../core/tokens";

const REAP_THRESHOLD = "15 minutes"; // matches the opportunistic reaper in attachSyncInfo
const REAP_PERIOD_MS = 5 * 60_000; // every 5 min

/**
 * Background reaper (reliability hardening). The opportunistic reaper only fires when someone loads
 * the connections page — so an orphaned queued/running run (worker lost/restarted) could sit forever
 * and permanently block new syncs via uq_sync_inflight. This timer reaps stale in-flight runs across
 * all orgs on a cadence via `app_reap_orphaned_syncs` (SECURITY DEFINER, cross-org). The reap UPDATE
 * is a single atomic statement, so two API instances running this concurrently is safe (whoever's
 * row-lock wins reaps; the other sees the row no longer matches). No leader election needed.
 */
@Injectable()
export class SyncReaperBootstrap implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SyncReaperBootstrap.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  onModuleInit(): void {
    // First tick a minute after boot (let any in-flight run settle), then on the cadence.
    setTimeout(() => void this.tick(), 60_000);
    this.timer = setInterval(() => void this.tick(), REAP_PERIOD_MS);
    this.logger.log("Sync reaper on: orphaned in-flight runs cleared every 5 min.");
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const { rows } = await this.db.query<{ app_reap_orphaned_syncs: number }>(
        "SELECT app_reap_orphaned_syncs($1::interval)",
        [REAP_THRESHOLD],
      );
      const n = rows[0]?.app_reap_orphaned_syncs ?? 0;
      if (n > 0) this.logger.warn(`Reaped ${n} orphaned sync run(s).`);
    } catch (err) {
      this.logger.error(`Sync reaper tick failed: ${(err as Error).message}`);
    }
  }
}
