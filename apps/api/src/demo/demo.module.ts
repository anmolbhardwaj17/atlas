import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConnectionsModule } from "../connections/connections.module";
import { DemoService } from "./demo.service";
import { DemoController } from "./demo.controller";

/**
 * Demo data (P1.2, docs/09 §8). Imports AuthModule for the guards; the pool comes from
 * the global CoreModule. Reuses `@atlas/ingest`'s `seedDemoData` (shared with the CLI seed) to
 * load, and ConnectionsModule's ConnectionService (disconnect purge) to clear.
 */
@Module({
  imports: [AuthModule, ConnectionsModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
