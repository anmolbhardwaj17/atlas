import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { CoreModule } from "./core/core.module";
import { AuthModule } from "./auth/auth.module";
import { AuthGuard } from "./auth/auth.guard";
import { OrgsModule } from "./orgs/orgs.module";
import { ConnectionsModule } from "./connections/connections.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { GraphModule } from "./graph/graph.module";
import { ComplianceModule } from "./compliance/compliance.module";
import { DigestModule } from "./digest/digest.module";
import { IncidentsModule } from "./incidents/incidents.module";
import { SearchModule } from "./search/search.module";
import { AiModule } from "./ai/ai.module";
import { DemoModule } from "./demo/demo.module";
import { AuditModule } from "./audit/audit.module";
import { WebhookModule } from "./webhooks/webhook.module";
import { SlackModule } from "./slack/slack.module";
import { DiscordModule } from "./discord/discord.module";
import { HealthController } from "./health/health.controller";
import { ObservabilityModule } from "./observability/observability.module";
import { ResponseInterceptor } from "./common/response.interceptor";
import { LoggingInterceptor } from "./common/logging.interceptor";
import { HttpExceptionFilter } from "./common/http-exception.filter";

/** Root module. Feature modules (connections, graph, …) are added per the docs/02 module map. */
@Module({
  imports: [
    CoreModule,
    AuthModule,
    OrgsModule,
    ConnectionsModule,
    NotificationsModule,
    GraphModule,
    ComplianceModule,
    DigestModule,
    IncidentsModule,
    SearchModule,
    AiModule,
    DemoModule,
    AuditModule,
    WebhookModule,
    SlackModule,
    DiscordModule,
    ObservabilityModule,
  ],
  controllers: [HealthController],
  providers: [
    // Outermost first: LoggingInterceptor times + logs the whole request (incl. the envelope).
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Global authentication: every route requires a valid bearer token unless marked @Public()
    // (webhook / digest-unsubscribe / health). Removes the "forgot AuthGuard on a new controller"
    // failure mode; per-controller TenantScope/Roles guards still apply where declared.
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
})
export class AppModule {}
