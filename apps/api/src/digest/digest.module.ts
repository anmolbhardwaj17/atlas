import { Module } from "@nestjs/common";
import { GraphModule } from "../graph/graph.module";
import { DigestController } from "./digest.controller";
import { WeeklyDigestService } from "./weekly-digest.service";
import { WeeklyDigestBootstrap } from "./weekly-digest.bootstrap";

/**
 * Weekly posture digest (#44). Reuses GraphService (`summary`) for the same findings/posture the
 * dashboard shows, EmailService (global via CoreModule) for delivery, and a self-scheduling bootstrap
 * that sends exactly once per week across instances/restarts. The unsubscribe route is public — the
 * signed token authenticates it — so no AuthModule guard here.
 */
@Module({
  imports: [GraphModule],
  controllers: [DigestController],
  providers: [WeeklyDigestService, WeeklyDigestBootstrap],
})
export class DigestModule {}
