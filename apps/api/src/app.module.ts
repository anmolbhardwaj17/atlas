import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { CoreModule } from "./core/core.module";
import { AuthModule } from "./auth/auth.module";
import { OrgsModule } from "./orgs/orgs.module";
import { ConnectionsModule } from "./connections/connections.module";
import { GraphModule } from "./graph/graph.module";
import { SearchModule } from "./search/search.module";
import { AiModule } from "./ai/ai.module";
import { HealthController } from "./health/health.controller";
import { ResponseInterceptor } from "./common/response.interceptor";
import { HttpExceptionFilter } from "./common/http-exception.filter";

/** Root module. Feature modules (connections, graph, …) are added per the docs/02 module map. */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    OrgsModule,
    ConnectionsModule,
    GraphModule,
    SearchModule,
    AiModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
