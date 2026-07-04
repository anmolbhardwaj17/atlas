import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Env } from "@atlas/config";
import { ENV } from "../core/tokens";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "../auth/auth.types";
import { AiService } from "./ai.service";
import { AskSchema, CreateConversationSchema, SetLlmConfigSchema } from "./dto";

/** Minimal raw response for manual SSE (avoids a hard fastify type dep). `hijack` tells Fastify
 *  we own the socket, so it won't try to send/close its own reply mid-stream. */
interface SseReply {
  hijack?: () => void;
  raw: {
    writeHead(status: number, headers: Record<string, string>): void;
    write(chunk: string): boolean;
    end(): void;
  };
}

/**
 * AI (docs/08 §10.2). Member+. The messages endpoint streams SSE (retrieval/token/
 * citation/confidence/done); insufficient grounding streams an honest-absence message with
 * `confidence: insufficient` (US-11), never a fabrication.
 */
@Controller("ai")
@UseGuards(AuthGuard, TenantScopeGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** BYO-LLM config for the org (docs/10 §3). GET is Member (the UI shows model/provider,
   *  never the key); PUT/DELETE are Admin. */
  @Get("settings")
  @Roles("Member")
  async getSettings(
    @Req() req: AuthedRequest,
  ): Promise<{ provider: string; model: string } | null> {
    return this.ai.getLlmConfig(org(req).id);
  }

  @Put("settings")
  @Roles("Admin")
  async setSettings(@Req() req: AuthedRequest, @Body() body: unknown): Promise<unknown> {
    const { provider, model, apiKey } = parseBody(SetLlmConfigSchema, body);
    return this.ai.setLlmConfig(org(req).id, provider, model, apiKey);
  }

  @Delete("settings")
  @Roles("Admin")
  async deleteSettings(@Req() req: AuthedRequest): Promise<{ ok: true }> {
    await this.ai.deleteLlmConfig(org(req).id);
    return { ok: true };
  }

  @Post("conversations")
  @Roles("Member")
  async create(@Req() req: AuthedRequest, @Body() body: unknown): Promise<unknown> {
    const { title } = parseBody(CreateConversationSchema, body);
    return this.ai.createConversation(org(req).id, req.auth?.userId ?? null, title);
  }

  @Get("conversations")
  @Roles("Member")
  async listConversations(@Req() req: AuthedRequest): Promise<unknown> {
    return this.ai.listConversations(org(req).id);
  }

  @Get("conversations/:id")
  @Roles("Member")
  async get(@Req() req: AuthedRequest, @Param("id") id: string): Promise<unknown> {
    return this.ai.getConversation(org(req).id, id);
  }

  @Post("conversations/:id/messages")
  @Roles("Member")
  async ask(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res() reply: SseReply,
  ): Promise<void> {
    const { message } = parseBody(AskSchema, body);
    const orgId = org(req).id;
    // Take the socket from Fastify so it doesn't try to send/close its own reply after we start
    // streaming (that race can drop the SSE connection mid-answer -> "stream interrupted").
    reply.hijack?.();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // don't let any proxy buffer the stream
      // Hijacking bypasses Fastify's CORS hook, so the streamed response would ship WITHOUT
      // `Access-Control-Allow-Origin` — the browser then blocks the cross-origin body ("Failed to
      // fetch" -> "stream interrupted"). Set it ourselves to match the app origin (docs/08 §3).
      "Access-Control-Allow-Origin": this.env.WEB_ORIGIN,
      Vary: "Origin",
    });
    // Flush a comment immediately so the connection is live during retrieval, and keep it alive
    // with a heartbeat (retrieval over a remote DB can be idle for seconds before the first token).
    reply.raw.write(": open\n\n");
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);
    try {
      for await (const ev of this.ai.askStream(orgId, id, message)) {
        reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (err) {
      // Surface the real reason (model 429/404, bad key, etc.) — include `type` so the client
      // renders it instead of silently swallowing an untyped event.
      const message = err instanceof ApiException ? err.message : (err as Error).message;
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ type: "error", message: message || "The AI request failed." })}\n\n`,
      );
    } finally {
      clearInterval(heartbeat);
    }
    reply.raw.end();
  }
}

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
