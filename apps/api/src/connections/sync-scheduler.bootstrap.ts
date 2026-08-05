import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import type { Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import { PG_POOL, ENV } from "../core/tokens";
import { LeaderLockService } from "../core/leader-lock.service";
import { ConnectionService } from "./connection.service";

/**
 * Auto-refresh scheduler (docs/06 §11). Every tick it asks `app_due_syncs` (SECURITY DEFINER,
 * cross-org) which connections are stale and triggers a re-sync for each via ConnectionService
 * (which scopes per-org, checks credentials, and respects BR-SYNC-1). Off unless
 * SYNC_INTERVAL_MINUTES > 0. Requires durable secrets so a sync can resolve credentials without a
 * reconnect.
 *
 * Leader-locked (deploy readiness P0-5). Enqueue itself is already idempotent — BullMQ dedupes on
 * `jobId` — so concurrent ticks would not double-sync; the lock is here so N replicas don't each
 * resolve credentials and walk the whole due-list every cadence to do work only one of them lands.
 */
@Injectable()
export class SyncSchedulerBootstrap implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SyncSchedulerBootstrap.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly connections: ConnectionService,
    private readonly leader: LeaderLockService,
  ) {}

  onModuleInit(): void {
    const minutes = this.env.SYNC_INTERVAL_MINUTES;
    if (!minutes || minutes <= 0) {
      this.logger.log("Auto-refresh disabled (SYNC_INTERVAL_MINUTES=0).");
      return;
    }
    if (!this.env.SECRET_ENCRYPTION_KEY) {
      this.logger.warn("Auto-refresh needs SECRET_ENCRYPTION_KEY (durable secrets) — skipping.");
      return;
    }
    const periodMs = minutes * 60_000;
    // First tick shortly after boot, then on the cadence.
    setTimeout(() => void this.tick(minutes), 20_000);
    this.timer = setInterval(() => void this.tick(minutes), periodMs);
    this.logger.log(`Auto-refresh on: re-sync sources idle > ${minutes} min.`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(thresholdMinutes: number): Promise<void> {
    try {
      await this.leader.runExclusive("syncSchedule", async () => {
        const { rows } = await this.db.query<{ org_id: string; connection_id: string }>(
          "SELECT org_id, connection_id FROM app_due_syncs($1::interval)",
          [`${thresholdMinutes} minutes`],
        );
        if (rows.length === 0) return;
        this.logger.log(`Auto-refresh: ${rows.length} source(s) due.`);
        for (const r of rows) {
          try {
            await this.connections.triggerSync(r.org_id, r.connection_id);
          } catch (err) {
            // A source with unresolvable creds / a transient error is skipped, not fatal.
            this.logger.warn(`Auto-refresh skipped ${r.connection_id}: ${(err as Error).message}`);
          }
        }
      });
    } catch (err) {
      this.logger.error(`Auto-refresh tick failed: ${(err as Error).message}`);
    }
  }
}
