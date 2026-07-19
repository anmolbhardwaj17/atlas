import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AiModule } from "../ai/ai.module";
import { DiscordController } from "./discord.controller";
import { DiscordAdminController } from "./discord-admin.controller";
import { DiscordService } from "./discord.service";

/**
 * Discord "Ask Atlas" chat integration (HTTP interactions). Reuses the AI answer engine (AiModule →
 * AiService); ENV/PG_POOL come from the global CoreModule. AuthModule supplies the guards for the
 * authed admin routes. No SecretBroker — Discord uses one app-level bot token (env).
 */
@Module({
  imports: [AuthModule, AiModule],
  controllers: [DiscordController, DiscordAdminController],
  providers: [DiscordService],
  exports: [DiscordService],
})
export class DiscordModule {}
