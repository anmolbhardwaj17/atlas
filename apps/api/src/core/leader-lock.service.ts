import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Db } from "@atlas/db";
import { PG_POOL } from "./tokens";

/**
 * Cross-instance mutual exclusion for the scheduled background ticks, via Postgres **advisory
 * locks** (deploy readiness P0-5).
 *
 * The problem: the schedulers are plain `setInterval` timers inside the app process, written when a
 * single dev process was the only runtime ("the in-process dev slice of the Scheduler — a
 * leader-elected worker is the deploy target"). The moment prod runs more than one task with the
 * cadence env vars set — two API replicas, or an API plus a dedicated worker, or an autoscaled
 * worker — every one of them ticks. For the ticks whose work is NOT idempotent that means duplicate
 * side effects: the notification dispatcher reads a watermark, sends, then writes the watermark, so
 * two dispatchers send the same Slack alert twice AND run `autoDiagnose` twice (duplicated LLM
 * spend); the health poller re-crawls every connected cloud account, doubling third-party API calls
 * against the same rate limits.
 *
 * Why an advisory lock rather than a leader-election table or a Redis lock:
 *  - No migration, no new table, no TTL/heartbeat to get wrong — Postgres already arbitrates, and we
 *    already require Postgres. Redis is required in prod too, but the DB is the thing the tick's own
 *    work is transacting against, so co-locating the lock avoids a split-brain across two stores.
 *  - **Crash-safe by construction:** the lock is session-scoped, so if the holder's process dies or
 *    its connection drops, Postgres releases it immediately. A leader that dies mid-tick costs one
 *    skipped tick, never a permanently stuck schedule — which a table-based lease with a TTL would.
 *
 * Per-TICK, not per-process: each tick tries the lock, works, releases. No long-lived leader, so no
 * failover delay and no thundering-herd on restart — whichever instance gets there first does that
 * tick, the others no-op instantly. Ticks are cadence-driven, so "first one wins" is exactly right.
 *
 * Scope note: advisory locks are database-global. Two Atlas deployments sharing ONE database would
 * contend for these keys (they'd elect a leader across both) — don't share a database across
 * environments, which the tenant model already assumes.
 */

/** Namespace half of the (int, int) advisory key — keeps Atlas's locks from colliding with any
 *  other advisory-lock user in the same database. Arbitrary but fixed. */
const ATLAS_LOCK_NAMESPACE = 0x4a1a; // "ATLA"

/** The scheduled ticks that need mutual exclusion. Idempotent ticks are deliberately absent — the
 *  retention sweep (age-based), the sync reaper (single atomic UPDATE), the weekly digest (per-org
 *  claim via `app_claim_digest_org`) and sync enqueue (BullMQ `jobId` dedupe) are already safe to
 *  run everywhere, and taking a lock for them would only add a needless serialization point. */
export const LEADER_LOCKS = {
  healthPoll: 1,
  notificationDispatch: 2,
  syncSchedule: 3,
} as const;

export type LeaderLockName = keyof typeof LEADER_LOCKS;

@Injectable()
export class LeaderLockService {
  private readonly logger = new Logger(LeaderLockService.name);

  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  /**
   * Run `fn` only if this instance wins the lock for `name`; otherwise return false immediately
   * (another instance is running this tick). Returns whatever happened to `fn` — errors propagate to
   * the caller's existing try/catch, and the lock is always released.
   */
  async runExclusive(name: LeaderLockName, fn: () => Promise<void>): Promise<boolean> {
    const key = LEADER_LOCKS[name];
    const client = await this.db.connect();
    // Same hazard withOrgScope guards (packages/db/src/client.ts): a checked-out client can emit an
    // async socket `error`, and with no listener that event is unhandled and kills the process. A
    // scheduler tick holds this client for the whole tick, so it is MORE exposed than a request is.
    let broken = false;
    const onError = (err: Error): void => {
      broken = true;
      this.logger.warn(`leader-lock client error during "${name}" (recovered): ${err.message}`);
    };
    client.on("error", onError);
    let held = false;
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1, $2) AS locked",
        [ATLAS_LOCK_NAMESPACE, key],
      );
      held = rows[0]?.locked === true;
      if (!held) return false;
      await fn();
      return true;
    } finally {
      if (held && !broken) {
        // Best-effort: if this fails the session is already gone, which releases the lock anyway.
        await client
          .query("SELECT pg_advisory_unlock($1, $2)", [ATLAS_LOCK_NAMESPACE, key])
          .catch(() => undefined);
      }
      client.removeListener("error", onError);
      client.release(broken);
    }
  }
}
