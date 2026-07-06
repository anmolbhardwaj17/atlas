import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import type { Db } from "@atlas/db";
import type { Env } from "@atlas/config";
import { PG_POOL, ENV } from "../core/tokens";
import { NotificationService } from "./notification.service";

/**
 * Notification dispatcher (dev in-process slice, like the health poller). Every tick it asks
 * app_notification_orgs() (SECURITY DEFINER, cross-org) which orgs have an enabled channel and
 * dispatches each one's pending alerts + digest. Off unless NOTIFY_INTERVAL_MINUTES > 0.
 */
@Injectable()
export class NotificationDispatcherBootstrap implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationDispatcherBootstrap.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly notifications: NotificationService,
  ) {}

  onModuleInit(): void {
    const minutes = this.env.NOTIFY_INTERVAL_MINUTES;
    if (!minutes || minutes <= 0) {
      this.logger.log("Notifications dispatcher disabled (NOTIFY_INTERVAL_MINUTES=0).");
      return;
    }
    setTimeout(() => void this.tick(), 25_000);
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    this.logger.log(`Notifications dispatcher on: every ${minutes} min.`);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { rows } = await this.db.query<{ org_id: string }>(
        "SELECT org_id FROM app_notification_orgs()",
      );
      for (const r of rows) {
        try {
          await this.notifications.dispatch(r.org_id);
        } catch (err) {
          this.logger.warn(`dispatch failed for ${r.org_id}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.error(`notification tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
