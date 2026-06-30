import { Controller, Get } from "@nestjs/common";

/** Liveness/health endpoint. Expanded with dependency checks (DB, Redis, …) in later sprints. */
@Controller("health")
export class HealthController {
  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
  }
}
