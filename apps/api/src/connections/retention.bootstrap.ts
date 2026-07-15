import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { RetentionService } from "./retention.service";

const TICK_MS = 24 * 60 * 60_000; // daily; the sweep is idempotent, so a missed/duplicate run is fine

/**
 * Retention scheduler (compliance scan S2 — storage-limitation). Ticks daily and runs the cross-org
 * expiry sweep. No cross-instance claim needed: `app_purge_expired` is age-based + idempotent, so two
 * instances (or a post-restart catch-up) just find less to delete. First run is shortly after boot so
 * a long-lived deployment doesn't wait a full day for its first purge.
 */
@Injectable()
export class RetentionBootstrap implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionBootstrap.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly retention: RetentionService) {}

  onModuleInit(): void {
    setTimeout(() => void this.tick(), 120_000); // 2 min after boot
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.logger.log("Retention scheduler on: daily expiry sweep (snapshots/events/sync-runs).");
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const r = await this.retention.purgeExpired();
      const total = r.snapshots + r.nodeEvents + r.syncRuns + r.analytics;
      if (total > 0) {
        this.logger.log(
          `Retention: purged ${r.snapshots} snapshots, ${r.nodeEvents} events, ${r.syncRuns} sync-runs, ${r.analytics} analytics.`,
        );
      }
    } catch (err) {
      this.logger.error(`Retention tick failed: ${(err as Error).message}`);
    }
  }
}
