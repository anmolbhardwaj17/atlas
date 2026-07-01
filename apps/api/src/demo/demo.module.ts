import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DemoService } from "./demo.service";
import { DemoController } from "./demo.controller";

/**
 * Demo data (P1.2, docs/09 §8). Imports AuthModule for the guards; the pool comes from
 * the global CoreModule. Reuses `@atlas/ingest`'s `seedDemoData` (shared with the CLI seed).
 */
@Module({
  imports: [AuthModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
