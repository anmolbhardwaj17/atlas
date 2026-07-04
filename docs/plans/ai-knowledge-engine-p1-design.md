# P1 — Agentic Graph‑RAG Retrieval Loop — Detailed Design

> Implementation‑ready design for **Phase 1** of `docs/plans/ai-knowledge-engine.md`: replace the
> fixed single‑shot planner with a **hybrid, tool‑calling retrieval loop**, without giving up any
> of the deterministic trust guarantees (grounding gate, deterministic citations, confidence,
> tenant isolation). When we build this, `docs/10` §4/§13 is updated in the same change.
>
> **Non‑goals for P1** (deferred): knowledge packs / advisory answers (P2), `describe_config` /
> `find_by_condition` (P2), re‑ranking & richer indexing (P3), MCP (P4). P1 ships **open‑ended
> factual + aggregate questions across providers**, correctly grounded and cited.

---

## 1. What P1 changes, in one picture

```
                       ┌───────────────────────────── AiService.askStream ─────────────────────────────┐
question ─▶ ROUTER ────┤                                                                                │
                       │  fast‑path (canonical intents)  ──▶ existing single‑shot plan/orchestrate ─────┼─▶ buildContext ─┐
                       │                                                                                │                 │
                       │  agentic‑path (everything else) ──▶  RETRIEVAL LOOP  ──▶ accumulated context ──┼─────────────────┤
                       └────────────────────────────────────────────────────────────────────────────┘                 │
                                                                                                                        ▼
                                                              grounding gate ─▶ narrate(synthesis, stream) ─▶ cite ─▶ confidence ─▶ SSE
```

The **back half is unchanged** (`grounding gate → narrate → cite → confidence → SSE`). P1 only introduces the router and the loop as an alternative way to *fill the context*. Fast‑path answers stay byte‑for‑byte as today (DD‑2 preserved).

---

## 2. Provider contract extension (the one real gap)

The agentic loop must feed tool results back to the model across turns. Today `ChatMessage` is
`{ role: "user"|"assistant"; content: string }` — it can't carry a tool call or a tool result.

**DD‑P1‑1 — Extend the message model to be tool‑turn aware (OpenAI/Anthropic‑compatible).**

```ts
// packages/ai/src/llm.ts
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }   // model asked to call tools
  | { role: "tool"; toolCallId: string; name: string; content: string }; // our result back

export interface ToolCall { id: string; name: string; input: Record<string, unknown>; }
```

- `OpenRouterProvider` maps these to OpenAI shape: assistant `{ tool_calls:[…] }`, and `{ role:"tool", tool_call_id, content }`. `ClaudeProvider` maps to Anthropic `tool_use`/`tool_result` blocks. Both already parse tool‑call *output*; this adds tool‑turn *input*.
- Backward compatible: existing single‑shot callers pass only `user`/`assistant` string messages.
- The provider already emits `{type:"tool_call"}` + `{type:"stop", reason}` — the loop consumes those. `stop.reason === "tool_calls"` (OpenAI) / `tool_use` (Anthropic) means "I want to call tools."

This is the only interface change; everything else composes on top.

---

## 3. The router (hybrid — DD‑P1‑2)

Deterministic first, agentic for the tail. Cheap and testable.

```ts
type Route = { kind: "fast"; plan: RetrievalPlan } | { kind: "agentic" };

function route(question: string, port, orgId): Route {
  const intent = classifyIntent(question);          // existing rules
  if (CANONICAL.has(intent)) return { kind: "fast", plan: await plan(...) };
  return { kind: "agentic" };                        // lookup‑default, aggregate, comparative, advisory, exploratory
}
const CANONICAL = new Set(["blast_radius","dependents","deploy_mapping","culprit","timeline"]);
```

- `blast_radius / dependents / deploy_mapping / culprit / timeline` stay fast‑path (their fixed plans are correct and cheap).
- `architecture / lookup / out_of_scope` and **everything unmatched** → agentic (the tail that fails today).
- `out_of_scope` still short‑circuits to honest‑absence *before* any model call (unchanged).
- **OQ‑P1‑a:** later, a tiny‑model classifier can replace the regex for ambiguous routing (extends OQ‑AI‑2). Not required for P1 — rules ship first.

---

## 4. The retrieval loop (core algorithm — DD‑P1‑3)

```
loop(question, orgId):
  ctx      = new ContextAccumulator()        # holds cited facts across hops (§6)
  messages = [ user(LOOP_TASK_PROMPT(question)) ]
  for hop in 1..MAX_HOPS:                      # MAX_HOPS = 5 (budget, §7)
     calls = []; assistantText = ""
     for ev in llm.complete({system: PLANNER_SYSTEM, messages, tools: TOOL_SPECS, temperature:0, maxTokens: 512}):
        if ev.type == "token":     assistantText += ev.text
        if ev.type == "tool_call": calls.push(ev)
        if ev.type == "stop":      stopReason = ev.reason
     if calls.empty:                            # model produced no tool calls → done planning
        break
     messages.push(assistant("", toolCalls=calls))
     for c in calls:                            # execute (parallel‑safe, all read‑only)
        result = TOOLS[c.name].run(orgId, c.input)   # org‑scoped, bounded
        ctx.add(result)                         # merge cited facts, dedup
        messages.push(tool(c.id, c.name, summariseForModel(result)))   # compact, budget‑aware
     if ctx.tokens > CTX_BUDGET or hop == MAX_HOPS:
        ctx.note("retrieval truncated to budget"); break
  return ctx
```

**Key properties:**
- **Two‑model‑role split (optional, cost):** the *loop* uses a small/fast model (planning = pick tools); the *final synthesis* (§8) uses the top model. Both behind `LLMProvider` (DD‑1). P1 can ship single‑model and split later — no interface change.
- **The loop never streams prose to the user.** Tokens emitted during planning are ignored for output (they're the model "thinking about which tool"). Only the **final synthesis** streams (§8). During the loop we stream *progress* events (§9) for "show your work".
- **Termination:** model stops calling tools (it has enough) **or** `MAX_HOPS` / `CTX_BUDGET` hit → force synthesis with what's gathered + a truncation note (AIR‑8, never silent).
- **Determinism for tests:** with the **mock provider** emitting a scripted sequence of tool_calls then a stop, the loop is fully deterministic and unit‑testable (DD‑6).

---

## 5. Tool registry (P1 set — DD‑P1‑4)

Each tool: typed input schema, read‑only, **org‑scoped below the tool** (RLS + `GraphService`, AE‑7/R8), bounded. Returns `RetrievedFact[]` already carrying `cite:` ids so citation binding stays deterministic (§6, DD‑5).

| Tool | Input | Returns | Backed by (exists?) |
|---|---|---|---|
| `search` | `{ q, kind?, limit≤10 }` | candidate nodes (id, kind, name, score) | `SearchProvider.search` ✅ |
| `get_node` | `{ id }` | node detail + provenance | `GraphService.getNode` ✅ |
| `get_neighbors` | `{ id, edgeType?, direction }` | 1‑hop edges (typed) | `GraphService.nodeEdges` ✅ |
| `traverse` | `{ id, mode:"blast"\|"deps", depth≤5 }` | impact/dep closure | `GraphService.blastRadius/dependencies` ✅ |
| `timeline` | `{ sinceDays≤90, kinds? }` | recent changes | `GraphService.timeline` ✅ |
| `aggregate` | `{ metric, groupBy, window? }` | ranked counts (top contributors, repos by activity, resources by kind) | reuse dashboard aggregations ⚠️ new port method |
| `estate_overview` | `{}` | inventory + trust tiers + top contributors + active repos + findings | reuse `DashboardSummary` ⚠️ new port method |
| `list_by_kind` | `{ kind, limit≤50 }` | enumerate nodes of a kind | `GraphService` query ⚠️ thin new method |

**Tool guardrails (production):**
- Hard input clamps (`limit`, `depth`, `sinceDays`) enforced server‑side, never trusting model input (AIR‑7).
- Unknown tool / bad args → structured tool error back to the model (it can recover), not a 500.
- Every tool result is **summarised for the model** (compact, token‑frugal) but the **full cited facts** go into the `ContextAccumulator` for the final answer + provenance drawer.
- `aggregate`/`estate_overview`/`list_by_kind` are the **P0 quick‑win** tools — they alone fix today's failure and can land before the loop (as fixed intents), then get reused by the loop.

**RetrievalPort additions (`packages/ai/src/retrieval-port.ts` + `apps/api/.../graph-retrieval.port.ts`):**
```ts
aggregate(orgId, metric, groupBy, window?): Promise<RankedFacts>
estateOverview(orgId): Promise<EstateOverview>
listByKind(orgId, kind, limit): Promise<RetrievedNode[]>
```

---

## 6. Context accumulation & deterministic citations across hops

The multi‑hop loop must still produce the **same deterministic citation binding** as today (DD‑5). Solution: a `ContextAccumulator` that is the multi‑hop generalisation of today's `buildContext`.

- Maintains stable markers (`N1, N2…`, `E1…`) with de‑dup by id across **all** hops (a node seen in hop 1 and hop 3 keeps one marker).
- Tracks `cites: Cite[]` (marker → real node/edge id + confidence) exactly as today → the Citation Engine binds the final answer's markers unchanged (DD‑5).
- New fact shapes get markers too: an `aggregate` row cites the **underlying nodes** where available (e.g. a contributor row → the `Person` node id) and otherwise the **computation** (`agg:top_contributors` → provenance = the query + inputs). Marker scheme extended: `A1` for aggregate facts, `S1` for a guidance/source fact (reserved for P2 advisory).
- On `CTX_BUDGET`: compact oldest/lowest‑relevance facts to summaries **with a note** (AIR‑8), never silent drop.
- Emits the same `BuiltContext { context, cites, nodesConsidered, freshnessNotes }` the synthesis + gate already consume — so §8 downstream is unchanged.

---

## 7. Budgets & termination (bounded by construction — AIR‑7/8)

| Budget | Default | Enforced |
|---|---|---|
| `MAX_HOPS` (loop iterations) | 5 | loop counter |
| tool calls / answer | 12 | counter across hops |
| rows/nodes per tool | tool‑specific clamp | in the tool |
| `CTX_BUDGET` (context tokens) | ~6k | accumulator, compaction |
| loop planning tokens/hop | 512 | `maxTokens` |
| synthesis tokens | 1024 | `maxTokens` |

Exhaustion is a **graceful degrade**: synthesise from what's gathered + `freshnessNotes` truncation note. Never a silent partial. Total per‑answer cost is bounded and predictable (cost model in `docs/17`).

---

## 8. Grounding gate, synthesis, citations, confidence (back half — mostly unchanged)

- **Grounding gate (DD‑4):** runs on the accumulated context. Grounded iff ≥1 fact was retrieved relevant to the question. Empty accumulator → honest‑absence (US‑11). *No advice/answer on zero facts.* (Advisory‑specific gating is P2.)
- **Synthesis (narration):** the **top model** streams the final answer from the accumulated CONTEXT with the existing closed‑context system prompt (L2/L3) — the model may use **only** the accumulated facts (unchanged hallucination defense). Tokens stream to the user here (and only here).
- **Citation binding (DD‑5):** unchanged — binds markers in the answer to `cites`.
- **Confidence (§5 of docs/10):** unchanged weakest‑link roll‑up over cited facts. (`advisory` tier is P2.)
- **Uncited‑claim detector (L5):** unchanged — factual sentence with no citation → flagged/suppressed.

The trust machinery is **identical**; only context *assembly* changed. That's the whole point.

---

## 9. Streaming / SSE — "show your work" during the loop (FR‑6.7, AE‑8)

Extend the SSE event set (`docs/08` §10.2) so the UI can render loop progress (and for auditability):

```
event: retrieval_step   data: { hop, tool, summary }     # NEW — one per tool call ("Searched repos… found 12")
event: retrieval        data: { nodesConsidered, intent } # existing — emitted when loop ends
event: token            data: { text }                    # synthesis only (existing)
event: citation         data: { … }                       # existing
event: confidence       data: { overall, caveats }        # existing
event: done             data: { grounded, citations }     # existing
```

`ask-chat.tsx` phases (`searching → thinking → answering`) already exist; map `retrieval_step` → a live "Looked at: repositories, contributors…" trace under the "Searching your graph…" state. This makes the agentic loop **inspectable**, which is itself a trust feature (G2).

### 9.1 Transport evolution — SSE → WebSocket (DD‑P1‑5)

P1 keeps the **existing SSE** transport working (it's the fastest path to shipping the loop, and the event schema above is transport‑agnostic). But the target for the conversation surface is a **WebSocket**, because the agentic loop is inherently a *bidirectional, multi‑event, long‑lived* interaction where SSE is a poor fit:

**Why WebSocket here (not just "SSE is fine"):**
- **Cancel / interrupt** — a user can stop a running answer mid‑loop (kill the tool loop + LLM stream server‑side). SSE has no client→server channel, so today a "stop" means abandoning the response, not stopping the work/cost. With the agentic loop spending real tokens across hops, server‑side cancellation matters (cost + UX).
- **Smoother progress** — the loop emits many `retrieval_step` events; a persistent socket delivers them with lower per‑event overhead and no reconnection churn than re‑opening streams.
- **Multi‑turn on one connection** — follow‑ups ("what about its security groups") reuse the open socket + server‑side session/memory (§9 of `docs/10`), instead of a fresh POST+hijack per turn (which is exactly what caused our CORS/`reply.hijack` pain — WS sidesteps that class of bug entirely).
- **Presence / typing / liveness** — natural on WS; awkward on SSE.

**Design (production‑grade, not a rewrite):**
- **One WS endpoint** for the conversation stream (`/ai/ws` or a NestJS WebSocket gateway); **REST stays** for CRUD (list/create/get conversations, settings) — WS is only the *live answer channel*.
- **Message protocol** = the same event union as §9, JSON‑framed both ways:
  - client→server: `{ t:"ask", conversationId, message }`, `{ t:"cancel", conversationId }`
  - server→client: `retrieval_step` · `token` · `citation` · `confidence` · `done` · `error` (identical payloads to the SSE events — the engine doesn't change, only the pipe).
- **Auth:** Supabase JWT passed on the WS handshake (query param or first `auth` frame), verified by the **same `SupabaseJwtVerifier`**; org scoping via the same `X‑Atlas‑Org` equivalent in the connect payload. Reject → close with a code. (No cookies; keeps the Bearer model.)
- **Cancellation:** each `ask` runs under an `AbortController`; a `cancel` frame (or socket close) aborts the tool loop + the provider stream (`streamAsk` already threads an optional `AbortSignal`; the loop passes it into every tool + `llm.complete`).
- **Scaling (Fargate, `docs/17`):** WS is sticky per connection; behind the ALB use connection draining + heartbeats (ping/pong) for liveness; the answer is stateless per‑message (no cross‑node fan‑out needed for MVP — one user, one socket, one node). Reconnect with backoff on the client; in‑flight answer is resumable‑or‑restart (MVP: restart, with the conversation already persisted).
- **Fallback:** keep SSE as a degradation path if the WS can't connect (proxies/corp networks) — the client tries WS, falls back to the existing SSE endpoint. Same event schema means the UI renderer is shared.

**Client:** `browser-api.ts` gains a `openAskSocket(conversationId)` returning an async‑iterator of the same `AskEvent`s (so `ask-chat.tsx` consumption barely changes) + a `cancel()`. The `streamAsk` SSE path stays as the fallback.

This is added as a **dedicated build step** (§14 step 6b) so it lands after the loop + event schema are proven over SSE, minimizing risk (we don't debug the new engine and a new transport at once).

---

## 10. Prompt contracts (two prompts — versioned, eval‑gated per DD‑6)

- **`PLANNER_SYSTEM`** (loop): "You are Atlas's retrieval planner. To answer the user's question about their engineering graph, call the provided tools to gather facts. Call tools until you have enough grounded facts, then stop (produce no tool call). Prefer specific tools (`aggregate`, `estate_overview`) for counts/rankings; `search`→`get_node`→`get_neighbors`/`traverse` for entities. Never answer from your own knowledge here — only gather." (It plans; it does not write the answer.)
- **`SYSTEM_PROMPT`** (synthesis): the existing closed‑context narrator prompt (`docs/10` §8) — unchanged. Uses ONLY accumulated CONTEXT, cites every fact, honest absence, low temp.

Both versioned; changes run the eval set before rollout.

---

## 11. Failure modes & degradation

| Case | Behaviour |
|---|---|
| Tool throws / bad args | structured tool‑error message back to model → it retries/adjusts; if repeated, degrade to synthesis with what's gathered |
| Model loops (same tool, no progress) | dedup detection: identical `(tool,input)` twice → drop + nudge; MAX_HOPS backstop |
| Empty retrieval after loop | honest absence (US‑11), with "I searched X, Y, Z — nothing matched" (from `retrieval_step` trace) |
| Budget exhausted | synthesise + truncation note (AIR‑8) |
| Provider outage mid‑loop | existing provider‑error SSE (`event: error`) — degrades AI, exploration unaffected (NFR‑7) |

---

## 12. Evaluation (the production bar — `docs/14`, DD‑6)

- **Deterministic loop tests:** mock provider scripts `[tool_call(search…), tool_call(get_node…), stop]` → assert the accumulator, gate, and citations. No network, fully reproducible.
- **Golden questions × classes:** aggregate ("top contributors" → correct ranked people, cited), lookup, relational, comparative — expected grounding + citation coverage.
- **Adversarial:** questions engineered to tempt the model to answer from parametric knowledge in the *loop* (must not); questions with no data (must refuse); cross‑tenant probes (US‑12/R8).
- **Metrics gate:** hallucination < 1%→0, citation coverage of factual clauses = 100%, honest‑absence correctness, tool‑budget adherence.

---

## 13. File‑level change map

| File | Change |
|---|---|
| `packages/ai/src/llm.ts` | Extend `ChatMessage` (tool turns), add `ToolCall` (DD‑P1‑1) |
| `packages/ai/src/openrouter-provider.ts` | Map tool‑turn messages → OpenAI shape (assistant `tool_calls`, `role:"tool"`) |
| `packages/ai/src/claude-provider.ts` | Map tool‑turn messages → Anthropic `tool_use`/`tool_result` |
| `packages/ai/src/tools.ts` *(new)* | `TOOL_SPECS` + registry + input clamps + `run` dispatch |
| `packages/ai/src/retrieval-port.ts` | Add `aggregate` / `estateOverview` / `listByKind`; fact/return types |
| `packages/ai/src/loop.ts` *(new)* | The retrieval loop (§4) + `ContextAccumulator` (§6) |
| `packages/ai/src/router.ts` *(new)* | Hybrid router (§3) |
| `packages/ai/src/answer.ts` | `prepare` branches: fast‑path (today) vs loop; wire `retrieval_step` events |
| `packages/ai/src/context.ts` | Generalise `buildContext` into/alongside `ContextAccumulator` (aggregate/`A` markers) |
| `packages/ai/src/prompt.ts` | Add `PLANNER_SYSTEM`; keep `SYSTEM_PROMPT` |
| `apps/api/.../graph-retrieval.port.ts` | Implement `aggregate`/`estateOverview`/`listByKind` over `GraphService` |
| `apps/api/.../graph.service.ts` | Expose aggregation queries (reuse `DashboardSummary`/`overview`) |
| `apps/api/.../ai.controller.ts` | Stream new `retrieval_step` SSE event |
| `apps/web/.../ask-chat.tsx` | Render `retrieval_step` trace under the searching state |
| `docs/10`, `docs/08` §10.2 | Update pipeline §4, SSE events, DD recap (same change) |
| tests | loop unit tests (mock provider), tool clamps, golden/adversarial evals |

---

## 14. Build sequence within P1 (each step green before the next)

1. **P0 slice first:** `estateOverview`/`aggregate`/`listByKind` in the port + `GraphService`; add `estate` + `aggregate` fast‑path intents; ship — **fixes today's visible failure**, no loop yet, fully testable.
2. Provider message‑model extension (DD‑P1‑1) + provider mappers + tests.
3. `tools.ts` registry (wrap the port methods as tools with clamps) + tool unit tests.
4. `loop.ts` + `ContextAccumulator` + deterministic mock‑provider loop tests.
5. `router.ts` + wire agentic path into `answer.ts` behind the router.
6. `retrieval_step` SSE + `ask-chat.tsx` trace.
7. **WebSocket transport (§9.1, DD‑P1‑5):** NestJS WS gateway for the live answer channel + `cancel`, JWT‑on‑handshake, `AbortController` wired through the loop; client `openAskSocket()` with SSE fallback. Lands *after* the loop is proven over SSE (don't debug new engine + new transport together).
8. Golden + adversarial eval set; CI gate.
9. `docs/10`/`08` update + board.

Steps 1 is shippable value on day one; 2–5 build the engine; 6–8 make it production‑grade.

---

## 15. Design decisions & open questions (P1)

**DDs:** DD‑P1‑1 tool‑turn message model · DD‑P1‑2 hybrid rule‑first router · DD‑P1‑3 bounded tool loop with deterministic tests · DD‑P1‑4 typed read‑only org‑scoped tool registry returning pre‑cited facts.

**OQs:** OQ‑P1‑a router regex vs tiny‑model (extends OQ‑AI‑2) · OQ‑P1‑b single‑model vs small‑planner/top‑synthesiser split (ship single, split on cost data) · OQ‑P1‑c `aggregate` metric vocabulary (start: `top_contributors`, `repos_by_activity`, `nodes_by_kind`, `findings_by_severity`) · OQ‑P1‑d parallel vs sequential tool execution per hop (start parallel; all read‑only).

---

## 16. Cross‑refs

`docs/plans/ai-knowledge-engine.md` (parent game‑plan), `docs/10` §2/§3/§4/§8/§13 (engine this evolves), `docs/08` §10.2 (SSE), `docs/09` §8.4 (rendering), `docs/11` (search/embeddings), `docs/14` (eval gate), `docs/17` (cost/routing), `packages/ai/src/*` (current implementation).
