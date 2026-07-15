import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiModule } from "../ai/ai.module";
import { ConnectionsModule } from "../connections/connections.module";
import { SlackController } from "./slack.controller";
import { SlackAdminController } from "./slack-admin.controller";
import { SlackService } from "./slack.service";

/**
 * Slack "Ask Atlas" chat integration. Reuses the AI answer engine (AiModule → AiService) and the
 * encrypted Secrets Broker (ConnectionsModule → SECRET_BROKER) for the bot token. ENV/PG_POOL come
 * from the global CoreModule. Exports SlackService so the Integrations controller can build the
 * "Add to Slack" install URL + report connection status.
 */
@Module({
  imports: [AuthModule, AiModule, ConnectionsModule],
  controllers: [SlackController, SlackAdminController],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
