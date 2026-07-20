import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiModule } from "../ai/ai.module";
import { ConnectionsModule } from "../connections/connections.module";
import { NotificationService } from "./notification.service";
import { NotificationController } from "./notification.controller";
import { NotificationDispatcherBootstrap } from "./notification-dispatcher.bootstrap";

/**
 * Proactive notifications (Slack alerts + daily digest + autonomous diagnosis). Imports
 * AuthModule for the guards, AiModule for the autonomous-diagnosis agent (AiService), and
 * ConnectionsModule for the Secrets Broker (webhook URLs are encrypted at rest, like connector creds).
 */
@Module({
  imports: [AuthModule, AiModule, ConnectionsModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationDispatcherBootstrap],
})
export class NotificationsModule {}
