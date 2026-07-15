import { Controller, Get, Post, Query, Req, Res } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { SlackService } from "./slack.service";

/** Raw request: the exact body bytes (Slack signs them) + headers. Same shape as the GitHub webhook. */
interface RawRequest {
  rawBody?: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

/** The bits of the Fastify reply we use — kept minimal to stay version-agnostic. */
interface ReplyLike {
  status(code: number): ReplyLike;
  header(name: string, value: string): ReplyLike;
  send(payload?: unknown): unknown;
}

/**
 * Slack "Ask Atlas" ingress (chat integration). Unauthenticated by design — like the GitHub webhook,
 * there is no Atlas session: the slash-command SIGNATURE is the auth (verified in the service), and
 * the OAuth callback trusts its signed `state`. Marked @Public so the global AuthGuard doesn't 401 it.
 */
@Public()
@Controller("slack")
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  /** Slash command `/atlas <question>`. Acks fast; the answer is delivered async to response_url. */
  @Post("command")
  async command(@Req() req: RawRequest, @Res() reply: ReplyLike): Promise<void> {
    const result = await this.slack.command(req.rawBody ?? Buffer.alloc(0), req.headers);
    reply.status(result.status).send(result.body ?? "");
  }

  /** OAuth install redirect target — binds the workspace to the org, then bounces back to the app. */
  @Get("oauth/callback")
  async oauthCallback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() reply: ReplyLike,
  ): Promise<void> {
    const result = await this.slack.handleOAuthCallback(code ?? "", state ?? "");
    reply.status(302).header("Location", this.slack.resultRedirectUrl(result)).send();
  }
}
