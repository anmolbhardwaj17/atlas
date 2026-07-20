import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { Db } from "@atlas/db";
import { Public } from "../auth/public.decorator";
import { PG_POOL } from "../core/tokens";

/**
 * Liveness + readiness probes.
 *  - `GET /health` (liveness): is the process up? Cheap, no dependencies — orchestration uses it to
 *    decide whether to restart the pod.
 *  - `GET /health/ready` (readiness): can this pod actually serve? Probes the DB with a short-timeout
 *    `SELECT 1` and returns 503 if it can't reach Postgres, so the load balancer drains this pod
 *    instead of routing traffic that would 500. Liveness and readiness are deliberately separate — a
 *    transient DB blip should pull the pod out of rotation, NOT kill it.
 */
@Public()
@Controller("health")
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly db: Db) {}

  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<{ status: "ready"; db: "up" }> {
    try {
      await Promise.race([
        this.db.query("SELECT 1"),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("db readiness check timed out")), 2000),
        ),
      ]);
    } catch (e) {
      throw new ServiceUnavailableException({
        status: "not_ready",
        db: "down",
        error: e instanceof Error ? e.message : "database not reachable",
      });
    }
    return { status: "ready", db: "up" };
  }
}
