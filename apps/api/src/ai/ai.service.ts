import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { withOrgScope, type Db } from "@atlas/db";
import {
  answerQuestionStream,
  OpenRouterProvider,
  type AnswerCitation,
  type AnswerEvent,
  type LLMProvider,
} from "@atlas/ai";
import type { SecretBroker } from "@atlas/ingest";
import type { Env } from "@atlas/config";
import { ENV, PG_POOL } from "../core/tokens";
import { SECRET_BROKER } from "../connections/tokens";
import { ApiException } from "../common/errors";
import { GraphRetrievalPort } from "./graph-retrieval.port";
import { LLM_PROVIDER } from "./tokens";

export interface LlmConfigDto {
  provider: "openrouter" | "anthropic";
  model: string;
}

export interface ConversationDto {
  id: string;
  title: string | null;
  createdAt: string;
  messages: Array<{
    role: string;
    content: string;
    citations: unknown;
    confidence: string | null;
    createdAt: string;
  }>;
}

/**
 * AI conversations (docs/10 §9, docs/08 §10.2). Org-scoped (withOrgScope/RLS, AE-7).
 * `askStream` persists the user turn, streams the answer (retrieval→tokens→citations→
 * confidence→done), and persists the assistant turn (with citations + confidence) so the
 * transcript stays cited/tiered. Within-session memory = the persisted history (cross-turn
 * pronoun resolution is a follow-up).
 */
@Injectable()
export class AiService {
  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    private readonly port: GraphRetrievalPort,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The org's LLM config for the settings UI — never the key (BR-CONN-1). */
  async getLlmConfig(orgId: string): Promise<LlmConfigDto | null> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<LlmConfigDto>(
        `SELECT provider, model FROM org_llm_config WHERE org_id = $1`,
        [orgId],
      );
      return rows[0] ?? null;
    });
  }

  /** Store the org's BYO-LLM: key → encrypted broker, provider+model+ref → org_llm_config. */
  async setLlmConfig(
    orgId: string,
    provider: LlmConfigDto["provider"],
    model: string,
    apiKey: string,
  ): Promise<LlmConfigDto> {
    const ref = await this.secrets.put(orgId, { apiKey });
    const oldRef = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ secret_ref: string }>(
        `SELECT secret_ref FROM org_llm_config WHERE org_id = $1`,
        [orgId],
      );
      await c.query(
        `INSERT INTO org_llm_config (org_id, provider, model, secret_ref) VALUES ($1,$2,$3,$4)
         ON CONFLICT (org_id) DO UPDATE SET provider=$2, model=$3, secret_ref=$4, updated_at=now()`,
        [orgId, provider, model, ref],
      );
      return rows[0]?.secret_ref ?? null;
    });
    if (oldRef && oldRef !== ref) await this.secrets.delete(oldRef).catch(() => undefined);
    return { provider, model };
  }

  async deleteLlmConfig(orgId: string): Promise<void> {
    const oldRef = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ secret_ref: string }>(
        `SELECT secret_ref FROM org_llm_config WHERE org_id = $1`,
        [orgId],
      );
      await c.query(`DELETE FROM org_llm_config WHERE org_id = $1`, [orgId]);
      return rows[0]?.secret_ref ?? null;
    });
    if (oldRef) await this.secrets.delete(oldRef).catch(() => undefined);
  }

  /** Pick the narrator: the org's BYO-LLM (OpenRouter) if configured + key resolves, else the
   *  env default (Claude when ANTHROPIC_API_KEY is set, otherwise the dev mock). */
  private async resolveProvider(orgId: string): Promise<LLMProvider> {
    const cfg = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ provider: string; model: string; secret_ref: string }>(
        `SELECT provider, model, secret_ref FROM org_llm_config WHERE org_id = $1`,
        [orgId],
      );
      return rows[0];
    });
    if (cfg?.provider === "openrouter") {
      const material = await this.secrets.get(cfg.secret_ref);
      if (material.apiKey) {
        return new OpenRouterProvider({
          apiKey: material.apiKey,
          model: cfg.model,
          referer: this.env.WEB_ORIGIN,
          title: "Atlas",
        });
      }
    }
    return this.llm;
  }

  async createConversation(
    orgId: string,
    createdBy: string | null,
    title?: string,
  ): Promise<{ id: string }> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO ai_conversations (org_id, created_by, title) VALUES ($1,$2,$3) RETURNING id`,
        [orgId, createdBy, title ?? null],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("conversation insert returned no id");
      return { id };
    });
  }

  async getConversation(orgId: string, id: string): Promise<ConversationDto> {
    return withOrgScope(this.db, orgId, async (c) => {
      const conv = await this.loadConversation(c, id);
      const { rows } = await c.query<{
        role: string;
        content: string;
        citations: unknown;
        confidence: string | null;
        created_at: Date;
      }>(
        `SELECT role, content, citations, confidence, created_at FROM ai_messages
          WHERE conversation_id = $1 ORDER BY created_at ASC`,
        [id],
      );
      return {
        id: conv.id,
        title: conv.title,
        createdAt: conv.created_at.toISOString(),
        messages: rows.map((m) => ({
          role: m.role,
          content: m.content,
          citations: m.citations,
          confidence: m.confidence,
          createdAt: m.created_at.toISOString(),
        })),
      };
    });
  }

  /** Stream an answer for a message, persisting both the user and assistant turns. */
  async *askStream(
    orgId: string,
    conversationId: string,
    message: string,
  ): AsyncIterable<AnswerEvent> {
    await withOrgScope(this.db, orgId, (c) => this.loadConversation(c, conversationId));
    await withOrgScope(this.db, orgId, (c) =>
      this.insertMessage(c, orgId, conversationId, "user", message, [], null),
    );

    const llm = await this.resolveProvider(orgId);
    let text = "";
    const citations: AnswerCitation[] = [];
    let confidence: string | null = null;
    for await (const ev of answerQuestionStream({ port: this.port, llm }, orgId, message)) {
      if (ev.type === "token") text += ev.text;
      else if (ev.type === "citation") citations.push(ev.citation);
      else if (ev.type === "confidence") confidence = ev.overall;
      yield ev;
    }

    await withOrgScope(this.db, orgId, (c) =>
      this.insertMessage(c, orgId, conversationId, "assistant", text, citations, confidence),
    );
  }

  private async loadConversation(
    c: PoolClient,
    id: string,
  ): Promise<{ id: string; title: string | null; created_at: Date }> {
    const { rows } = await c.query<{ id: string; title: string | null; created_at: Date }>(
      `SELECT id, title, created_at FROM ai_conversations WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw ApiException.notFound();
    return row;
  }

  private async insertMessage(
    c: PoolClient,
    orgId: string,
    conversationId: string,
    role: string,
    content: string,
    citations: unknown[],
    confidence: string | null,
  ): Promise<void> {
    await c.query(
      `INSERT INTO ai_messages (org_id, conversation_id, role, content, citations, confidence)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [orgId, conversationId, role, content, JSON.stringify(citations), confidence],
    );
  }
}
