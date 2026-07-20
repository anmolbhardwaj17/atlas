import { Global, Module } from "@nestjs/common";
import { MetricsService } from "./metrics.service";
import { MetricsController } from "./metrics.controller";

/**
 * Observability (docs/02 §9.4): the process-wide Prometheus registry + its `/metrics` scrape
 * endpoint. `@Global` so the LoggingInterceptor and the sync worker can inject `MetricsService`
 * without re-importing this module.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
