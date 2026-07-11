import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { IncidentsController } from "./incidents.controller";
import { IncidentsService } from "./incidents.service";

/**
 * War Room incidents (docs/plans/war-room.md). Persists an investigation opened from a red map node /
 * finding / alert so it survives the session and builds history. The diagnosis itself reuses the
 * existing AI streaming loop (client-driven); this module owns the durable incident record. PG pool is
 * global; AuthModule supplies the guards.
 */
@Module({
  imports: [AuthModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
