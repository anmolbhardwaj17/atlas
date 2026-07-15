import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";

/** Liveness/health endpoint. Expanded with dependency checks (DB, Redis, …) in later sprints. */
@Public()
@Controller("health")
export class HealthController {
  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
  }
}
