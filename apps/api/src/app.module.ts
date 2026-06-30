import { Module } from "@nestjs/common";
import { CoreModule } from "./core/core.module";
import { AuthModule } from "./auth/auth.module";
import { HealthController } from "./health/health.controller";

/** Root module. Feature modules (connections, graph, …) are added per the docs/02 module map. */
@Module({
  imports: [CoreModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
