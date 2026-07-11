import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GraphModule } from "../graph/graph.module";
import { IncidentsController } from "./incidents.controller";
import { IncidentsService } from "./incidents.service";
import { AlertsController } from "./alerts.controller";
import { AlertPolicyService } from "./alert-policy.service";
import { ProactiveIncidentsService } from "./proactive-incidents.service";

/**
 * War Room incidents (docs/plans/war-room.md) + proactive incidents (docs/plans/proactive-incidents.md).
 * Owns the durable incident record + the alert policy; `ProactiveIncidentsService` (used by the health
 * poller) auto-opens an incident on a qualifying regression. GraphModule supplies the deterministic
 * headline's inputs (node events + dependencies).
 */
@Module({
  imports: [AuthModule, GraphModule],
  controllers: [IncidentsController, AlertsController],
  providers: [IncidentsService, AlertPolicyService, ProactiveIncidentsService],
  exports: [IncidentsService, AlertPolicyService, ProactiveIncidentsService],
})
export class IncidentsModule {}
