import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditController } from "./audit.controller";

/**
 * Audit log read API (docs/13 §8). Imports AuthModule for the guards; `AuditService` comes
 * from the @Global CoreModule (same instance that records events).
 */
@Module({
  imports: [AuthModule],
  controllers: [AuditController],
})
export class AuditModule {}
