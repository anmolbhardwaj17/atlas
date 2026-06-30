import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";

/** Root module. Feature modules (auth, connections, graph, …) are added per the docs/02 module map. */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
