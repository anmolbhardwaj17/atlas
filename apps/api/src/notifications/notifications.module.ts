import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiModule } from "../ai/ai.module";
import { NotificationService } from "./notification.service";
import { NotificationController } from "./notification.controller";
import { NotificationDispatcherBootstrap } from "./notification-dispatcher.bootstrap";

/**
 * Proactive notifications (Slack alerts + daily digest + autonomous diagnosis). Imports
 * AuthModule for the guards and AiModule for the autonomous-diagnosis agent (AiService).
 */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationDispatcherBootstrap],
})
export class NotificationsModule {}
