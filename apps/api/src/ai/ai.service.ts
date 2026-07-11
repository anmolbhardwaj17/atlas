import { Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { withOrgScope, type Db } from "@atlas/db";
import {
  answerQuestion,
  answerQuestionStream,
  judgeCoverage,
  matchEdges,
  suggestIntentLinks,
  OpenRouterProvider,
  ClaudeProvider,
  type AnswerCitation,
  type AnswerEvent,
  type CoverageAssessment,
  type CoverageInputs,
  type FuzzyIssue,
  type FuzzyPr,
  type IntentIssue,
  type LLMProvider,
} from "@atlas/ai";
import type { SecretBroker } from "@atlas/ingest";
import type { Env } from "@atlas/config";
import { ENV, PG_POOL } from "../core/tokens";
import { SECRET_BROKER } from "../connections/tokens";
import { ApiException } from "../common/errors";
import { RateLimitService } from "../core/rate-limit.service";
import { GraphRetrievalPort } from "./graph-retrieval.port";
import { EdgeSuggestionService } from "./edge-suggestion.service";
import { GraphService } from "../graph/graph.service";
import { LLM_PROVIDER } from "./tokens";

export type LlmProviderId = "openrouter" | "openai" | "anthropic";

export interface LlmConfigDto {
  provider: LlmProviderId;
  model: string;
}

/** Build an LLM provider for a BYO-LLM choice. OpenRouter + OpenAI are OpenAI-compatible (same
 *  fetch adapter, different endpoint); Anthropic uses the Claude SDK. */
function buildProvider(
  provider: LlmProviderId,
  model: string,
  apiKey: string,
  referer: string,
): LLMProvider {
  if (provider === "anthropic") return new ClaudeProvider({ apiKey, model });
  if (provider === "openai") {
    return new OpenRouterProvider({
      apiKey,
      model,
      endpoint: "https://api.openai.com/v1/chat/completions",
    });
  }
  return new OpenRouterProvider({ apiKey, model, referer, title: "Atlas" });
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
/** Abuse limits on AI (security sweep H2). Burst kills a tight request loop; the shared-key DAILY
 *  budget bounds spend on Atlas's own Anthropic key for an org with no BYO-LLM — a BYO org pays for
 *  its own usage and isn't daily-capped. Generous enough that real interactive use never trips them. */
const AI_BURST_LIMIT = 20; // asks per org …
const AI_BURST_WINDOW_S = 60; // … per 60s
const AI_SHARED_DAILY_LIMIT = 100; // asks per org per day on Atlas's shared key
const DAY_SECONDS = 24 * 60 * 60;

/** PR node kinds the coverage judge accepts (mirrors R18's linkable kinds). */
const PR_KINDS = ["bitbucket.pullrequest", "github.pull_request"];

/** Bound the fuzzy-link scan (it's O(prs × issues)); enough for a real estate, excess is reported. */
const INTENT_PR_CAP = 400;
const INTENT_ISSUE_CAP = 600;

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asStringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The Jira key out of an issue URN (`jira:<site>:issue/<KEY>` → `<KEY>`), upper-cased. */
function jiraKeyFromUrn(urn: string): string {
  return /issue\/([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(urn)?.[1]?.toUpperCase() ?? "";
}

/** Map a crawled `jira.issue` node's captured attributes (IV-1) into the judge's IntentIssue. */
function toIntentIssue(node: {
  id: string;
  name: string | null;
  attributes: Record<string, unknown>;
}): IntentIssue {
  const a = node.attributes;
  const subtasks = Array.isArray(a.subtasks)
    ? a.subtasks
        .map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return {
            key: asString(o.key),
            summary: asStringOrNull(o.summary),
            status: asStringOrNull(o.status),
          };
        })
        .filter((s) => s.key)
    : [];
  const comments = Array.isArray(a.comments)
    ? a.comments
        .map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return { author: asStringOrNull(o.author), text: asString(o.text) };
        })
        .filter((c) => c.text)
    : [];
  return {
    id: node.id,
    key: asString(a.key) || node.name || "",
    url: asStringOrNull(a.url),
    summary: asString(a.summary) || node.name || "",
    description: asString(a.description),
    subtasks,
    comments,
  };
}

@Injectable()
export class AiService {
  constructor(
    @Inject(PG_POOL) private readonly db: Db,
    private readonly port: GraphRetrievalPort,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(SECRET_BROKER) private readonly secrets: SecretBroker,
    @Inject(ENV) private readonly env: Env,
    private readonly rateLimit: RateLimitService,
    private readonly edgeSuggest: EdgeSuggestionService,
    private readonly graph: GraphService,
  ) {}

  /**
   * AI edge suggestions (docs/05 §6, docs/10) — propose repo→runtime links that deterministic
   * matching can't catch, written as `ai_suggested` edges for the user to confirm/reject. Gathers
   * unmatched runtimes + candidate repos, asks the model which plausibly deploy where (+ why), and
   * persists the accepted proposals. Atlas-initiated (like autoDiagnose): bounded by the caller's
   * Admin gate, not per-user budget. Needs a real (non-mock) model.
   */
  async suggestEdges(
    orgId: string,
  ): Promise<{ suggested: number; scannedRuntimes: number; overCap: number }> {
    // Cost + load guard: this scans the estate and spends LLM budget. Per-org, since it's an
    // org-wide Admin action (docs: rate-limit expensive endpoints).
    await this.rateLimit.enforce(
      orgId,
      "ai_suggest_edges",
      10,
      600,
      "AI link suggestions were just run. Give it a few minutes before running again.",
    );
    const ctx = await this.edgeSuggest.gather(orgId);
    if (ctx.input.runtimes.length === 0 || ctx.input.repos.length === 0) {
      return {
        suggested: 0,
        scannedRuntimes: ctx.input.runtimes.length,
        overCap: ctx.runtimesOverCap,
      };
    }
    const { llm } = await this.resolveProvider(orgId);
    if (llm.name === "mock") {
      throw ApiException.invalidState(
        "AI link suggestions need a configured model. Add a BYO-LLM key in Settings, or set ANTHROPIC_API_KEY.",
      );
    }
    const suggestions = await matchEdges(llm, ctx.input);
    const written = await this.edgeSuggest.write(orgId, suggestions, ctx);
    return {
      suggested: written,
      scannedRuntimes: ctx.input.runtimes.length,
      overCap: ctx.runtimesOverCap,
    };
  }

  /**
   * Intent-coverage review for a PR (IV-3, docs/plans/intent-verification.md §3). Assembles the
   * judge's inputs from the graph — the PR node, its linked Jira issue (via the R18 `IMPLEMENTS`
   * edge → the issue's captured intent attributes), and the on-demand PR diff — then runs the
   * `@atlas/ai` coverage judge. Everything is org-scoped (GraphService/port enforce RLS, R8). The
   * judge itself owns the honesty: it short-circuits to `no-intent`/`no-diff` and never fabricates a
   * gap (its suppression gate). A non-PR / cross-tenant / absent id → 404 via GraphService.getNode.
   */
  async coverageForPr(orgId: string, prNodeId: string): Promise<CoverageAssessment> {
    // Spends model budget + reads a diff from the source API → per-org rate limit (mirrors the AI
    // ask/suggest limits; generous enough that reviewing PRs interactively never trips it).
    await this.rateLimit.enforce(
      orgId,
      "ai_coverage",
      30,
      60,
      "You're reviewing PRs quickly — give it a moment before the next coverage check.",
    );

    const pr = await this.graph.getNode(orgId, prNodeId); // 404 if absent / cross-tenant (R8)
    if (!PR_KINDS.includes(pr.kind)) {
      throw ApiException.invalidState(
        "Intent coverage can only be reviewed for a pull request. Open a PR node and try again.",
      );
    }

    // The linked intent: the R18 IMPLEMENTS(pr → jira.issue) edge. No edge = no stated intent to
    // check against (the judge returns an honest `no-intent`, not a failure).
    const edges = await this.graph.nodeEdges(orgId, prNodeId, {
      direction: "out",
      type: "IMPLEMENTS",
      limit: 10,
    });
    const issueEdges = edges.filter((e) => e.to.kind === "jira.issue");
    // A PR can implement several tickets (e.g. a foundation story + a feature story). Judge against
    // the one whose key the author named IN THE PR TITLE — the strongest intent signal — rather than
    // an arbitrary first link, which would wrongly review the diff against a ticket it never targeted.
    const titleKeys = new Set((pr.name ?? "").toUpperCase().match(/[A-Z][A-Z0-9]{1,9}-\d+/g) ?? []);
    const issueEdge =
      issueEdges.find((e) => titleKeys.has(jiraKeyFromUrn(e.to.urn))) ?? issueEdges[0];
    let issue: IntentIssue | null = null;
    if (issueEdge) {
      const node = await this.graph.getNode(orgId, issueEdge.to.id);
      issue = toIntentIssue(node);
    }

    // Only fetch the (rate-limited, remote) diff when there's an issue to judge it against.
    const diff = issue ? await this.port.prDiff(orgId, prNodeId, 16_000) : null;

    const { llm } = await this.resolveProvider(orgId);
    const inputs: CoverageInputs = {
      pr: { id: pr.id, name: pr.name },
      issue,
      diff,
    };
    return judgeCoverage({ llm }, inputs);
  }

  /**
   * Fuzzy (no-key) PR↔issue linking (IV-4, docs/plans/intent-verification.md §1). For PRs with no
   * explicit-key `IMPLEMENTS` link (R18 found nothing), propose the ticket they likely implement from
   * deterministic signals (shared meaningful words + temporal proximity) and write them as
   * `ai_suggested` IMPLEMENTS edges the user confirms/rejects in the graph (the same loop as
   * repo→runtime suggestions). No LLM — the signals are deterministic. Skips already-rejected pairs.
   * Returns how many candidates were written. Org-scoped (RLS, R8); Admin-gated by the caller.
   */
  async suggestIntentLinks(
    orgId: string,
  ): Promise<{ suggested: number; scannedPrs: number; scannedIssues: number }> {
    await this.rateLimit.enforce(
      orgId,
      "ai_intent_links",
      10,
      600,
      "Link suggestions were just generated. Give it a few minutes before running again.",
    );
    return withOrgScope(this.db, orgId, async (c) => {
      // Unlinked PRs = no ACTIVE IMPLEMENTS edge out (explicit-key or previously confirmed).
      const { rows: prRows } = await c.query<{
        id: string;
        urn: string;
        name: string | null;
        attributes: Record<string, unknown>;
      }>(
        `SELECT id, urn, name, attributes FROM nodes n
          WHERE kind = ANY($1) AND status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM edges e
               WHERE e.from_node_id = n.id AND e.type = 'IMPLEMENTS' AND e.status = 'active'
            )
          ORDER BY last_seen DESC LIMIT $2`,
        [PR_KINDS, INTENT_PR_CAP],
      );
      const { rows: issueRows } = await c.query<{
        id: string;
        urn: string;
        attributes: Record<string, unknown>;
      }>(
        `SELECT id, urn, attributes FROM nodes
          WHERE kind = 'jira.issue' AND status = 'active'
          ORDER BY last_seen DESC LIMIT $1`,
        [INTENT_ISSUE_CAP],
      );
      if (prRows.length === 0 || issueRows.length === 0) {
        return { suggested: 0, scannedPrs: prRows.length, scannedIssues: issueRows.length };
      }

      const prs: FuzzyPr[] = prRows.map((r) => ({
        id: r.id,
        urn: r.urn,
        title: r.name ?? "",
        branch: asString(r.attributes.sourceBranch),
        createdAt: asStringOrNull(r.attributes.createdOn) ?? asStringOrNull(r.attributes.createdAt),
      }));
      const issues: FuzzyIssue[] = issueRows.map((r) => ({
        id: r.id,
        urn: r.urn,
        key: asString(r.attributes.key),
        summary: asString(r.attributes.summary),
        createdAt: asStringOrNull(r.attributes.createdAt),
      }));

      const suggestions = suggestIntentLinks(prs, issues);
      if (suggestions.length === 0) {
        return { suggested: 0, scannedPrs: prs.length, scannedIssues: issues.length };
      }

      const { rows: rejRows } = await c.query<{ from_node_id: string; to_node_id: string }>(
        `SELECT from_node_id, to_node_id FROM edge_suggestion_rejections WHERE type = 'IMPLEMENTS'`,
      );
      const rejected = new Set(rejRows.map((r) => `${r.from_node_id}→${r.to_node_id}`));

      let written = 0;
      for (const s of suggestions) {
        if (rejected.has(`${s.prId}→${s.issueId}`)) continue;
        const prov = await c.query<{ id: string }>(
          `INSERT INTO provenance (org_id, source, confidence, evidence)
           VALUES ($1, 'ai:intent-linker', 'ai-suggested', $2) RETURNING id`,
          [
            orgId,
            JSON.stringify({ matcher: "intent-linker", reasoning: s.reasoning, score: s.score }),
          ],
        );
        const provId = prov.rows[0]?.id;
        // Revive-on-conflict (mirrors edge-suggestion.write): a previously-retired suggestion for the
        // same pair collides on uq_edge; reviving is safe since rejected pairs are already skipped.
        const ins = await c.query<{ id: string }>(
          `INSERT INTO edges
             (org_id, from_node_id, to_node_id, type, origin, confidence, provenance_id, last_seen)
           VALUES ($1, $2, $3, 'IMPLEMENTS', 'ai_suggested', 'ai-suggested', $4, now())
           ON CONFLICT ON CONSTRAINT uq_edge DO UPDATE
             SET status = 'active', origin = 'ai_suggested', confidence = 'ai-suggested',
                 provenance_id = EXCLUDED.provenance_id, last_seen = now()
             WHERE edges.status <> 'active'
           RETURNING id`,
          [orgId, s.prId, s.issueId, provId],
        );
        if (ins.rowCount) written += 1;
      }
      return { suggested: written, scannedPrs: prs.length, scannedIssues: issues.length };
    });
  }

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

  /** Store the org's BYO-LLM: key → encrypted broker, provider+model+ref → org_llm_config.
   *  Runs a live probe FIRST (a tiny completion) so a bad key/model is rejected up front and
   *  never stored — the UI shows success/failure from this. */
  async setLlmConfig(
    orgId: string,
    provider: LlmConfigDto["provider"],
    model: string,
    apiKey: string,
  ): Promise<LlmConfigDto> {
    await this.verifyLlm(provider, model, apiKey);
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

  /** Live probe: a tiny completion to confirm the key + model actually work. Throws a 422 with
   *  the provider's error (bad key → 401, unknown/tool-less model → 4xx) so save fails clearly. */
  private async verifyLlm(provider: LlmProviderId, model: string, apiKey: string): Promise<void> {
    const probe = buildProvider(provider, model, apiKey, this.env.WEB_ORIGIN);
    try {
      let ok = false;
      for await (const ev of probe.complete({
        system: "You are a connectivity check.",
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
        maxTokens: 8,
        temperature: 0,
      })) {
        if (ev.type === "token" || ev.type === "stop") ok = true;
        if (ev.type === "stop") break;
      }
      if (!ok) throw new Error("the model returned no response");
    } catch (err) {
      throw new ApiException(
        422,
        "connection_verification_failed",
        `Model test failed: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  /** Pick the narrator: the org's BYO-LLM (OpenRouter) if configured + key resolves, else the
   *  env default (Claude when ANTHROPIC_API_KEY is set, otherwise the dev mock). `shared` is true
   *  when we fell back to Atlas's own key — the caller then applies the shared-key budget (H2). */
  private async resolveProvider(orgId: string): Promise<{ llm: LLMProvider; shared: boolean }> {
    const cfg = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ provider: string; model: string; secret_ref: string }>(
        `SELECT provider, model, secret_ref FROM org_llm_config WHERE org_id = $1`,
        [orgId],
      );
      return rows[0];
    });
    if (
      cfg?.provider === "openrouter" ||
      cfg?.provider === "openai" ||
      cfg?.provider === "anthropic"
    ) {
      const material = await this.secrets.get(cfg.secret_ref);
      if (material.apiKey) {
        return {
          llm: buildProvider(cfg.provider, cfg.model, material.apiKey, this.env.WEB_ORIGIN),
          shared: false,
        };
      }
    }
    return { llm: this.llm, shared: true };
  }

  /**
   * Autonomous diagnosis (the proactive agent). Given a resource that just went unhealthy,
   * run the SAME agentic diagnose loop a user would trigger - search → diagnose (health +
   * blast radius + change timeline) → cited hypothesis - with no human in the loop. Returns a
   * trimmed grounded hypothesis for the notification, or null (mock provider / not grounded /
   * error) so the caller falls back to the plain alert. Read-only throughout; it investigates
   * and advises, never acts.
   */
  async autoDiagnose(orgId: string, subject: string): Promise<string | null> {
    // Atlas-initiated (proactive) — not user-driven, so it is NOT rate-limited/budget-checked here;
    // it's already bounded by the notification dispatcher's own per-alert cap.
    const { llm } = await this.resolveProvider(orgId);
    if (llm.name === "mock") return null; // the loop needs a real tool-calling model
    try {
      const answer = await answerQuestion(
        { port: this.port, llm },
        orgId,
        `Why is ${subject} unhealthy right now? Diagnose the most likely cause, name any recent change or deploy that could be responsible, and say plainly if the timeline shows nothing conclusive. Be brief.`,
      );
      if (!answer.grounded || !answer.text.trim()) return null;
      // Strip citation markers ([N1]/[A2]/…) - Slack has no provenance panel to bind them to.
      const clean = answer.text.replace(/\s*\[[NEA]\d+\]/g, "").trim();
      return clean.length > 900 ? `${clean.slice(0, 900)}…` : clean;
    } catch {
      return null;
    }
  }

  async createConversation(
    orgId: string,
    createdBy: string | null,
    title?: string,
    origin: "ask" | "map" = "ask",
  ): Promise<{ id: string }> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO ai_conversations (org_id, created_by, title, origin) VALUES ($1,$2,$3,$4) RETURNING id`,
        [orgId, createdBy, title ?? null, origin],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("conversation insert returned no id");
      return { id };
    });
  }

  /** Recent conversations for the history sidebar (newest first). */
  /** Delete a conversation (and its messages, via ON DELETE CASCADE). Org-scoped: a
   *  cross-tenant id simply deletes nothing (RLS), which reads as an idempotent no-op. */
  async deleteConversation(orgId: string, id: string): Promise<{ deleted: boolean }> {
    return withOrgScope(this.db, orgId, async (c) => {
      const res = await c.query(`DELETE FROM ai_conversations WHERE id = $1`, [id]);
      return { deleted: (res.rowCount ?? 0) > 0 };
    });
  }

  async listConversations(
    orgId: string,
  ): Promise<Array<{ id: string; title: string | null; origin: string; createdAt: string }>> {
    return withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{
        id: string;
        title: string | null;
        origin: string;
        created_at: Date;
      }>(
        `SELECT id, title, origin, created_at FROM ai_conversations
          WHERE org_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [orgId],
      );
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        origin: r.origin,
        createdAt: r.created_at.toISOString(),
      }));
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
    userId?: string | null,
    signal?: AbortSignal,
  ): AsyncIterable<AnswerEvent> {
    // Abuse guard (H2), enforced here so BOTH transports (SSE controller + WS socket) are covered.
    // Burst first — cheap, kills a tight loop before any DB/LLM work. Keyed PER-USER so one member's
    // loop can't consume the whole org's burst allowance and DoS their teammates (the shared *cost*
    // budget below stays per-org). Falls back to a per-org bucket if the user is somehow unknown.
    await this.rateLimit.enforce(
      orgId,
      userId ? `ai_ask:${userId}` : "ai_ask",
      AI_BURST_LIMIT,
      AI_BURST_WINDOW_S,
      "You're sending AI requests too quickly. Give it a moment and try again.",
    );
    await withOrgScope(this.db, orgId, (c) => this.loadConversation(c, conversationId));
    // Load prior turns BEFORE inserting the new one - cross-turn memory (docs/10 §9), so a
    // follow-up ("explain that simpler", "why?") continues the thread instead of restarting.
    const history = await withOrgScope(this.db, orgId, async (c) => {
      const { rows } = await c.query<{ role: string; content: string }>(
        `SELECT role, content FROM ai_messages
          WHERE conversation_id = $1 AND role IN ('user','assistant')
          ORDER BY created_at ASC`,
        [conversationId],
      );
      return rows
        .filter((r) => r.role === "user" || r.role === "assistant")
        .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
    });
    const { llm, shared } = await this.resolveProvider(orgId);
    // When using Atlas's shared key (no BYO-LLM) and it's a real model, count this ask against the
    // org's daily budget — the hard bound on cost-DoS. mock (dev) is free; BYO orgs pay their own way.
    if (shared && llm.name !== "mock") {
      await this.rateLimit.enforce(
        orgId,
        "ai_shared",
        AI_SHARED_DAILY_LIMIT,
        DAY_SECONDS,
        "This organization has reached today's limit on Atlas's shared AI. Add your own API key in Settings → AI for unlimited use.",
      );
    }
    await withOrgScope(this.db, orgId, (c) =>
      this.insertMessage(c, orgId, conversationId, "user", message, [], null),
    );

    let text = "";
    const citations: AnswerCitation[] = [];
    let confidence: string | null = null;
    try {
      for await (const ev of answerQuestionStream(
        { port: this.port, llm },
        orgId,
        message,
        signal,
        history,
      )) {
        if (ev.type === "token") text += ev.text;
        else if (ev.type === "citation") citations.push(ev.citation);
        else if (ev.type === "confidence") confidence = ev.overall;
        yield ev;
      }
    } finally {
      // Persist even a partial answer (cancel/disconnect) so the turn isn't left dangling.
      if (text) {
        await withOrgScope(this.db, orgId, (c) =>
          this.insertMessage(c, orgId, conversationId, "assistant", text, citations, confidence),
        );
      }
    }
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
