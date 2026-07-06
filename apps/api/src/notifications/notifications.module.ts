import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationService } from "./notification.service";
import { NotificationController } from "./notification.controller";
import { NotificationDispatcherBootstrap } from "./notification-dispatcher.bootstrap";

/** Proactive notifications (Slack alerts + daily digest). Imports AuthModule for the guards. */
@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationDispatcherBootstrap],
})
export class NotificationsModule {}
