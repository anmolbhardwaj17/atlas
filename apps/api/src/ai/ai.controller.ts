import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { TenantScopeGuard } from "../auth/tenant-scope.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ApiException } from "../common/errors";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "../auth/auth.types";
import { AiService } from "./ai.service";
import { AskSchema, CreateConversationSchema, SetLlmConfigSchema } from "./dto";

/** Minimal raw response for manual SSE (avoids a hard fastify type dep). */
interface SseReply {
  raw: {
    writeHead(status: number, headers: Record<string, string>): void;
    write(chunk: string): void;
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
  constructor(private readonly ai: AiService) {}

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
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    try {
      for await (const ev of this.ai.askStream(orgId, id, message)) {
        reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (err) {
      const message = err instanceof ApiException ? err.message : "The AI request failed.";
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    }
    reply.raw.end();
  }
}

function org(req: AuthedRequest): { id: string } {
  if (!req.org) throw ApiException.orgAccessDenied("Missing org context.");
  return req.org;
}
