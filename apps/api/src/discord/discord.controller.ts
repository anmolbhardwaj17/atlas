import { Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { DiscordService } from "./discord.service";

interface RawRequest {
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

interface ReplyLike {
  status(code: number): ReplyLike;
  header(name: string, value: string): ReplyLike;
  send(payload?: unknown): unknown;
}

/**
 * Discord "Ask Atlas" ingress. Unauthenticated by design — the Ed25519 interaction signature is the
 * auth (verified in the service), and the OAuth callback trusts its signed `state`. @Public so the
 * global AuthGuard doesn't 401 it.
 */
@Public()
@Controller("discord")
export class DiscordController {
  constructor(private readonly discord: DiscordService) {}

  /** Interaction endpoint: PING→PONG for verification, `/atlas` command → deferred + async answer. */
  @Post("interactions")
  async interactions(@Req() req: RawRequest, @Res() reply: ReplyLike): Promise<void> {
    const result = await this.discord.interaction(req.rawBody ?? Buffer.alloc(0), req.headers);
    reply.status(result.status).send(result.body ?? "");
  }

  /** OAuth install redirect target — binds the guild to the org, then bounces back to the app. */
  @Get("oauth/callback")
  async oauthCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() reply: ReplyLike,
  ): Promise<void> {
    const result = await this.discord.handleOAuthCallback(code ?? "", state ?? "");
    reply.status(302).header("Location", this.discord.resultRedirectUrl(result)).send();
  }
}
