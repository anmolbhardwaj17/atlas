import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { WeeklyDigestService } from "./weekly-digest.service";

const SEND_HOUR_UTC = 14; // Monday 14:00 UTC (Monday is baked into weekSendMoment's math)
const TICK_MS = 60 * 60_000; // check hourly; the DB claim makes the actual send exactly-once/week

/**
 * Weekly-digest scheduler (#44). A plain 7-day interval can't work — deploys/restarts reset it before
 * it ever reaches 7 days of uptime — so this ticks hourly and lets the DB decide. Once we're at/past
 * this week's send moment (Mon 14:00 UTC), it claims the week's period key via `app_claim_digest_period`
 * (atomic, cross-instance) and only the winning caller sends. A late boot still catches up: any tick
 * after the send moment that finds the week unclaimed will send it.
 */
@Injectable()
export class WeeklyDigestBootstrap implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WeeklyDigestBootstrap.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly digest: WeeklyDigestService) {}

  onModuleInit(): void {
    // First tick shortly after boot (catch up a missed send), then hourly.
    setTimeout(() => void this.tick(), 90_000);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.logger.log("Weekly digest scheduler on: sends Monday 14:00 UTC (exactly once/week).");
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const sendMoment = weekSendMoment(now);
    if (now < sendMoment) return; // this week's send time hasn't arrived yet
    const periodKey = `digest-${sendMoment.toISOString().slice(0, 10)}`; // the week's Monday date
    try {
      const res = await this.digest.claimAndSend(periodKey);
      // Only log when this tick actually claimed + sent something — once the period is fully sent,
      // every later hourly tick returns 0 orgs and must stay quiet (per-org claim, migration 0065).
      if (res && res.orgs > 0)
        this.logger.log(`Weekly digest ${periodKey}: ${res.sent} sent / ${res.orgs} org(s).`);
    } catch (err) {
      this.logger.error(`Weekly digest tick failed: ${(err as Error).message}`);
    }
  }
}

/** The send moment (Mon 14:00 UTC) of the ISO week that contains `now`. */
function weekSendMoment(now: Date): Date {
  const d = new Date(now);
  const daysFromMonday = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  d.setUTCHours(SEND_HOUR_UTC, 0, 0, 0);
  return d;
}
