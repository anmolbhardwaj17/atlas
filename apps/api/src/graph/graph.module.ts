import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { GraphController } from "./graph.controller";
import { GraphService } from "./graph.service";

/** Graph read API (docs/08 §9). Imports AuthModule for the guards; PG pool is global. */
@Module({
  imports: [AuthModule],
  controllers: [GraphController],
  providers: [GraphService],
  // Exported so the sync worker can reconcile the finding lifecycle after each sync.
  exports: [GraphService],
})
export class GraphModule {}
