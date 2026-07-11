import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GraphModule } from "../graph/graph.module";
import { ComplianceController } from "./compliance.controller";
import { ComplianceService } from "./compliance.service";

/**
 * Compliance controls (docs/plans/compliance.md). Reuses GraphService (findings + inventory) to map
 * Atlas's technical evidence onto the infrastructure-observable subset of the frameworks.
 */
@Module({
  imports: [AuthModule, GraphModule],
  controllers: [ComplianceController],
  providers: [ComplianceService],
})
export class ComplianceModule {}
