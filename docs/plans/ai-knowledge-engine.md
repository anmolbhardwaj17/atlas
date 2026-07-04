# Plan — Atlas AI Knowledge Engine (Agentic Graph‑RAG)

> **Status:** design/game‑plan (pre‑build). Supersedes nothing yet; when we build, `docs/10`
> is updated **in the same change** (cardinal rule 1). Owner: Ask AI surface.
> Goal in one line: **turn Ask AI from a fixed‑intent narrator into a grounded expert that can
> answer any question about the org's system — AWS, Bitbucket, code, deploys — blending observed
> graph facts (cited) with domain expertise (labelled advice), production‑grade.**

---

## 0. What "complete knowledge" actually means

The user's ask: *"My AI should have complete knowledge of the system we've built… when AWS comes it should answer anything about AWS config, how things are set up, how to optimize; same for Bitbucket. Like a RAG app inside the system."*

Translated into Atlas's model, the AI must be strong at **three kinds of knowing**, and must never confuse them:

| Layer | What it is | Source | Trust treatment |
|---|---|---|---|
| **A — Facts** | "Your prod RDS `orders-db` has security group `sg‑123` open to `0.0.0.0/0:5432`." | **Only** the knowledge graph (observed/inferred), retrieved per question | **Cited** to a real node/edge + raw snapshot (P4). Never parametric. |
| **B — Expertise** | "A database reachable from the public internet on its DB port is a critical exposure; AWS Well‑Architected says restrict to the app tier." | The model's domain knowledge + curated **knowledge packs** per provider | **Labelled advisory** — a recommendation/best‑practice, *not* an observed fact |
| **C — Synthesis** | "Because `orders-db` is public **[fact, cited]** and holds PII **[fact, cited]**, this is a top‑priority fix; restrict `sg‑123` ingress to `sg‑app` **[advice]**." | Reasoning that binds B onto A | Each **factual** clause cited; each **recommendation** clearly marked advisory |

**The single governing rule (resolves the AE‑1 tension):**
> **Facts about the customer's system come *only* from the graph and are always cited.
> Domain expertise may be used *only* to interpret, prioritise, and advise on those facts —
> never to assert what exists. "What is" is grounded; "what you should do" is advisory.**

This keeps Atlas's entire trust model (P1/P3/P4, R3 anti‑hallucination) intact **and** unlocks the optimisation/advisory capability the user wants. It is a *refinement* of AE‑1, not a repeal: AE‑1 becomes "**never fabricate facts** from parametric knowledge" rather than "never use the model's knowledge at all."

---

## 1. Why the current engine can't do this yet (gap analysis)

Current pipeline (`docs/10` §4, as built): `plan → orchestrate → grounding gate → buildContext → narrate → cite → score`.

The planner (`packages/ai/src/planner.ts`) is a **fixed rule‑based classifier** with 7 intents (`blast_radius`, `dependents`, `deploy_mapping`, `architecture`, `timeline`, `culprit`, `lookup`). Retrieval (`retrieval.ts`) maps each intent to **one** bounded traversal. This is excellent for the canonical questions it was designed for — and structurally unable to handle everything else:

| Question the user will actually ask | Today | Why it fails |
|---|---|---|
| "Who are the top contributors on Bitbucket?" | ❌ "I don't have that data" | No **aggregate** intent → falls to `lookup` → semantic‑searches "contributors/bitbucket" → grabs **one PR** → narrates over it. (This is the exact failure we just saw.) |
| "How many repositories are there?" | ❌ | Same — counts/rankings aren't a retrieval primitive. |
| "Is my prod database exposed to the internet?" | ⚠️ partial | Can fetch the node, but has no notion of **evaluating** a config against a rule. |
| "How should I optimise my AWS setup for cost?" | ❌ | Advisory synthesis (Layer C) doesn't exist; AE‑1 currently forbids domain knowledge outright. |
| "What changed in the payments service last week and who did it?" | ⚠️ | Two intents at once (timeline + entity) — the fixed planner picks one. |
| "Compare the security groups of `orders-db` and `payments-db`." | ❌ | No multi‑entity / comparative retrieval. |

**Root cause:** retrieval strategy is chosen by a *closed* rule set and executes a *single* fixed move. Real questions are open‑ended, multi‑step, and sometimes advisory. We need retrieval that can **plan iteratively** and an answer contract that can **advise**, without giving up determinism where it matters (citations, grounding, isolation).

---

## 2. Target architecture — Agentic Graph‑RAG

Evolve the fixed planner into a **tool‑calling retrieval loop** (already anticipated in `docs/10` §2's dashed "may request more retrieval (tool call)" edge, DD‑3's `tools?`, and OQ‑AI‑2's "hybrid planner"). The model plans *what to retrieve* by calling **read‑only graph tools**, iterates until it has enough, then answers — with the **deterministic post‑processing unchanged** (grounding gate, citation binding, confidence, uncited‑claim detection).

```
Question
  │
  ├─▶ Fast‑path router (rules): canonical intents → fixed deterministic plan  ── (cheap, unchanged)
  │
  └─▶ Agentic path (long tail):
        LLM(planner)  ⇄  Retrieval Tools (read‑only, org‑scoped, bounded)
             │  tool_call: search / get_node / neighbors / traverse /
             │             aggregate / timeline / describe_config / compare / list_by_kind
             │  tool_result: cited facts appended to a working CONTEXT
             └─ loop until: enough grounded context  OR  tool budget hit
                     │
                     ▼
        Grounding gate ─▶ Narrate (synthesis, streamed) ─▶ Citation bind ─▶ Confidence ─▶ SSE
```

**Design commitments (production‑grade, not makeshift):**

1. **Hybrid, not all‑agentic.** Canonical questions keep their deterministic fast‑path (DD‑2 preserved: reliable, cheap, testable). Only the long tail enters the tool loop. Router is rule‑first, LLM‑fallback.
2. **Tools are the only way to touch data.** The model never sees raw DB access — it calls a fixed, typed, **read‑only, org‑scoped** tool surface (AE‑7/R8/P2 enforced *below* the tool, in `GraphService` + RLS). This is also exactly the surface we later publish as **MCP** (`docs/10` §12) — one design, two consumers.
3. **Every tool result is citation‑tagged at the source.** Tools return facts already carrying `cite:` ids (as `buildContext` does today), so citation binding stays deterministic (DD‑5) regardless of how many tool hops happened.
4. **Bounded.** Per‑answer tool‑call budget + per‑tool node/row budgets + total token budget (AIR‑7/AIR‑8). On exhaustion: answer from what's retrieved + a "I looked at N of M" note — never silent truncation.
5. **Deterministic guarantees survive.** Grounding gate (DD‑4), citation binding (DD‑5), confidence tiers (§5), uncited‑claim detection (L5), tenant isolation (AE‑7) all run **after** the loop, exactly as today. The loop changes *how context is gathered*, not *how truth is enforced*.

---

## 3. The retrieval toolset (the model's "graph query API")

A small, composable, provider‑agnostic set. Each is read‑only, org‑scoped, bounded, and returns cited facts. (★ = new vs. today.)

| Tool | Purpose | Backed by |
|---|---|---|
| `search(q, kind?, limit)` | Hybrid BM25+vector lookup → candidate nodes | `docs/11` search |
| `get_node(id)` | Full node detail + provenance | `GraphService.getNode` |
| `get_neighbors(id, edgeType?, dir)` | 1‑hop edges (typed, filterable) | `GraphService.nodeEdges` |
| `traverse(id, mode, depth)` | Blast radius / dependency closure | `GraphService.blastRadius/dependencies` |
| `timeline(sinceDays, kinds?)` | Recent changes | `GraphService.timeline` |
| ★ `aggregate(metric, groupBy, window?)` | Counts/rankings: top contributors, repos by activity, resources by kind, findings by severity | reuse `GraphService` summary/overview aggregations |
| ★ `estate_overview()` | The whole‑org snapshot (inventory, trust tiers, top contributors, active repos, findings) | reuse `DashboardSummary` |
| ★ `describe_config(id)` | Provider‑specific config detail for a resource (SG rules, IAM policy, encryption flags, pipeline steps, branch protection) | connector‑specific projections |
| ★ `list_by_kind(kind, filter?)` | Enumerate resources/repos/services with predicates ("RDS without encryption", "repos without CI") | indexed graph query |
| ★ `compare(idA, idB, aspect)` | Side‑by‑side of two entities on an aspect | composition of `describe_config` |
| ★ `find_by_condition(rule)` | Evaluate a **known** structural rule → matching nodes (e.g. "public + stores‑PII", ties into the security/vuln plan) | rule library over the graph |

**Phase‑0 quick win:** `estate_overview` + `aggregate` alone fix the entire class of dashboard‑style questions (top contributors, counts, most‑active) — the failures we can see *today*. Ship that first (see §12), independent of the larger loop.

---

## 4. Question taxonomy → how each is handled

Production means every class has a defined retrieval strategy, answer style, and trust treatment:

| Class | Example (AWS / Bitbucket) | Retrieval | Answer style |
|---|---|---|---|
| **Lookup** | "What region is `orders-db` in?" | `search`→`get_node` | Fact, cited (as today) |
| **Relational** | "What breaks if `orders-db` goes down?" | `traverse(blast)` | Cited chain + weakest‑link confidence |
| **Aggregate/Rank** | "Top contributors this month?" / "How many RDS instances?" | `aggregate` / `estate_overview` | Ranked facts, cited to the computation + underlying nodes |
| **Diagnostic** | "Which PR broke checkout?" | `timeline`+`traverse(CHANGED_BY)` | Ranked candidates, uncertainty stated (US‑6) |
| **Config‑inspect** | "Is `orders-db` publicly reachable? What are its SG rules?" | `describe_config` | Facts, cited to raw snapshot |
| **Advisory / Optimise** | "How do I harden/optimise this for cost/security?" | inspect + `find_by_condition` + **domain knowledge** | **Synthesis**: cited facts → labelled recommendations w/ rationale & tradeoffs |
| **Comparative** | "Compare prod vs staging DB config" | `compare` | Cited side‑by‑side + advisory delta |
| **Exploratory** | "Explain my architecture" | `estate_overview`→service‑centric subgraph | Summary + "ask about a service for detail" (budgeted) |
| **Out‑of‑scope** | "What's the capital of France?" | — | Decline + redirect (unchanged) |

---

## 5. Provider knowledge packs (AWS, Bitbucket, …)

Domain expertise (Layer B) is made **first‑class and per‑connector**, so "when AWS comes" the AI is immediately competent, and Bitbucket/GitHub get the same treatment.

A **knowledge pack** = a versioned, curated module per provider containing:
- **Rule library** — structural checks the AI can invoke via `find_by_condition` (e.g. AWS: SG open to `0.0.0.0/0` on sensitive ports; unencrypted RDS/EBS; public S3; over‑broad IAM `*`; no MFA. Bitbucket: no branch protection; no required reviewers; long‑lived branches; no CI on default branch).
- **Best‑practice corpus** — concise, retrievable guidance keyed to resource kinds/pillars (AWS Well‑Architected: cost/security/reliability/performance/operational‑excellence; Bitbucket/CI hygiene). Retrieved into CONTEXT only when relevant, so advice is grounded in a citable *guidance source*, not vibes.
- **Optimisation levers** — the actionable moves per kind (rightsizing, reserved capacity, lifecycle policies, tighten ingress, enable encryption, add pipeline gates).

Packs are **data, not prompt spaghetti** — extensible per connector (`docs/06` AWS, `docs/07`/`07b` Bitbucket/GitHub), versioned, and eval‑gated like prompts. This is what makes the AI "put its own knowledge" *safely*: the knowledge is curated, attributable, and applied only to grounded facts.

---

## 6. Advisory / optimisation answers (the "how do I optimise" flow)

The Layer‑C capability, made rigorous:

1. **Scope** the subject (entity, service, or whole estate) via the tools → grounded facts (cited).
2. **Evaluate** facts against the pack's rule library (`find_by_condition`) → concrete findings, each anchored to real nodes/edges.
3. **Synthesise** recommendations: for each finding, the model explains *why it matters* (best‑practice corpus, retrieved) and *what to change* (optimisation lever), with **tradeoffs** and **priority** (severity × grounded blast‑radius — reuse `traverse`).
4. **Render** with strict separation: every "what is" clause cited to the graph; every "you should" clause tagged **advisory** and tied to the finding it addresses. Confidence tier `advisory` is distinct from `observed`/`inferred`.

This dovetails with the **Security & Vulnerability plan** (`docs/plans/security-vulnerabilities.md`) — "exposed AND vulnerable" toxic‑combos are exactly `find_by_condition` rules; that plan's findings become first‑class advisory inputs here.

---

## 7. Retrieval quality — making RAG actually good

Grounded answers are only as good as retrieval. Production‑grade means investing here:

- **What we index (`docs/11`):** node summaries, resource **config projections** (SG rules, IAM statements, encryption flags), PR/commit/pipeline metadata, edge **evidence**, README/tag text (as untrusted data). Chunk at the node/config‑fragment level so retrieval returns citable units.
- **Hybrid search:** BM25 (exact ids/ARNs/`prod-orders`) + dense vectors (semantic "database that stores orders") + **re‑ranking** on the merged set. Identifiers must never be lost to fuzzy matching (already a concern in `extractTerms`).
- **Recency & confidence weighting** in ranking; stale scopes carry freshness caveats into the answer (US‑13).
- **Context assembly & budget:** structured, compacted CONTEXT with per‑fact `cite:`; summarise‑with‑note on overflow (AIR‑8), never silent drop.
- **Embeddings** behind the `LLMProvider.embed?` seam (DD‑1) or a dedicated model (`docs/11`) — swappable, cost‑routable.

---

## 8. Grounding, citations, confidence — evolved (trust stays visible)

- **Grounding gate** extends to accept aggregate/estate/advisory results as grounded (like `timeline` today). Advisory answers still require ≥1 grounded fact to stand on — **no advice on zero facts** (prevents "generic AWS lecture" with no data).
- **Citations** extend from node/edge to also cover **computations** ("top contributors — from N `AUTHORED` edges") and **guidance sources** (which best‑practice the advice derives from). Binding stays deterministic (DD‑5).
- **Confidence tiers** gain `advisory` alongside `observed`/`inferred‑high`/`inferred‑low`/`insufficient`; the UI (`docs/09` §8.4) renders it distinctly ("recommendation, not observed fact").
- **Uncited‑claim detector (L5)** now also flags a recommendation that isn't tied to any grounded finding → suppressed. This is the guardrail against the model free‑lancing AWS opinions.

---

## 9. Conversation, memory, multi‑turn

Real "knowledge assistant" UX needs solid follow‑ups: "what about *its* security groups", "and staging?", "why is that bad?". Implement running‑summary memory (`docs/10` §9, OQ‑AI‑4) + entity carry‑over (resolved node ids persist across turns) so the tool loop can reference the prior subject without re‑resolving.

---

## 10. Evaluation & QA (this is what makes it "production‑grade")

Non‑negotiable, gated in CI (`docs/14`, DD‑6):

- **Golden question set per provider × per class** (AWS lookup/config/advisory; Bitbucket aggregate/diagnostic; …) with expected grounding + citation coverage.
- **Metrics:** hallucination rate (< 1%, → 0), citation coverage of factual clauses (100%), honest‑absence correctness (refuses when it should), advisory‑without‑fact rate (→ 0), retrieval recall@k.
- **Adversarial QA agent** (existing decision) tries to make it fabricate facts, over‑claim advice as fact, or leak cross‑tenant data (US‑12/R8).
- **Telemetry‑driven expansion:** real questions that failed retrieval feed the eval set (AIR‑10).
- **Prompt/pack/model = one eval‑gated recipe** (DD‑6): knowledge packs and prompts are versioned and can't ship without passing.

---

## 11. Cost, latency, safety, observability

- **Model routing:** small/fast model for the tool‑planning loop + intent routing; top model for final synthesis (DD‑1, `docs/17`). Cache tool results within a turn.
- **Budgets:** tool‑call cap, per‑tool row/node caps, total token cap; graceful degrade with a note (AIR‑7/8).
- **Safety:** retrieved content stays untrusted/delimited (AIR‑4, `docs/13`); read‑only by construction (P2); org‑scoped tools only (AE‑7/R8); no advice that implies a write action Atlas would perform (Atlas never mutates the customer's cloud).
- **Observability:** "show your work" exposes every tool call + node considered (FR‑6.7/G2) — the agentic loop is fully inspectable, which is also a trust feature.

---

## 12. Phased roadmap (each phase shippable, dependency‑ordered)

| Phase | Deliverable | Value | Touches |
|---|---|---|---|
| **P0 — Aggregate quick win** *(days)* | `estate_overview` + `aggregate` tools wired as new planner intents; fixes top‑contributors/counts/most‑active **today** | Suggested questions finally work | `planner`, `retrieval`, `context`, `grounding`, `GraphRetrievalPort`, `GraphService` (reuse `DashboardSummary`), tests |
| **P1 — Agentic loop** | Tool‑calling retrieval loop + hybrid router; toolset (`search/get_node/neighbors/traverse/timeline/aggregate/list_by_kind/compare`); **+ WebSocket transport for the conversation** (bidirectional, live cancel/interrupt, smoother progress — see P1‑design §9.1) | Open‑ended factual questions across providers, smoother chat | `answer.ts` loop, tool specs, `LLMProvider` tool‑call path (already in `OpenRouterProvider`), WS gateway, budgets, evals |
| **P2 — Config inspect + AWS pack** | `describe_config`, `find_by_condition`, AWS knowledge pack, advisory answer contract + `advisory` confidence tier | "Is this secure / how do I optimise AWS" | knowledge‑pack module, rule library, prompt+UI advisory rendering, evals |
| **P3 — Bitbucket/GitHub pack + retrieval depth** | Bitbucket/GitHub packs; richer indexing + re‑ranking; comparative/exploratory | Parity across providers; better recall | packs, `docs/11` search work, evals |
| **P4 — Precomputed insights + MCP** | Background findings (ties to security/vuln plan); publish tool surface as MCP (`docs/10` §12) | Proactive intelligence + external agents | jobs, MCP server |

P0 is independent and unblocks the visible failure now; P1+ is the real architecture. Fits the roadmap order in `docs/15` (I‑layers → G‑layers → P‑layers).

---

## 13. Doc & board impact (cardinal rule 1 — docs first)

Building this **updates the blueprint in the same change**, not after:
- **`docs/10`** — rewrite §4 (pipeline → hybrid agentic loop), refine **AE‑1** to the fact/advisory split (§0 here), add the toolset (§3), advisory contract (§6/§8), new `advisory` confidence tier, evals (§10). Add DDs for: agentic‑hybrid retrieval, knowledge packs, advisory separation.
- **`docs/11`** — indexing of config projections + re‑ranking.
- **New `docs/19` (or extend `10`)** — **Knowledge Packs** spec (per‑provider rule library + best‑practice corpus format).
- **`docs/05`** — `find_by_condition` rule surface over the graph.
- **`PROJECT-BOARD.md`** — add the P0–P4 epics.

---

## 14. Risks & open questions (new/extended)

| ID | Risk | Mitigation |
|---|---|---|
| KE‑1 | Advice asserted as observed fact | Strict Layer‑A/B/C separation (§0), `advisory` tier, L5 flags advice without a grounded anchor |
| KE‑2 | Agentic loop cost/latency blow‑up | Hybrid router (canonical stays fixed), tool/token budgets, small‑model planner, caching (AIR‑7) |
| KE‑3 | Domain‑knowledge staleness/wrongness | Curated versioned packs, eval‑gated, cite the guidance source (not raw model opinion) |
| KE‑4 | Retrieval misses relevant nodes → false "no data" | Hybrid search + re‑rank, telemetry‑fed eval expansion, multi‑hop loop can retry with new terms |
| KE‑5 | Prompt injection via crawled config/README steering advice | Untrusted‑data delimiting (AIR‑4, `docs/13`); content‑as‑data; tools can't be invoked by retrieved text |
| KE‑6 | Advice implies a change Atlas might make | Read‑only stance explicit; advice is *for the human*, Atlas never writes (P2) |

**Open questions:** OQ‑KE‑1 planner: rules+small‑LLM router vs full‑LLM planner (lean hybrid, tune w/ telemetry — extends OQ‑AI‑2). OQ‑KE‑2 knowledge‑pack authoring: hand‑curated vs. generated‑then‑reviewed. OQ‑KE‑3 precompute findings vs. on‑demand (cost vs. latency). OQ‑KE‑4 embeddings model choice + cost (`docs/11`).

---

## 15. Cross‑refs

`docs/10` (AI engine — the doc this evolves), `docs/05` (graph/inference/confidence), `docs/11` (hybrid search), `docs/06`/`07`/`07b` (AWS/GitHub/Bitbucket connectors — the knowledge sources), `docs/08` §10.2 (SSE), `docs/09` §8.4 (answer rendering), `docs/13` (injection/isolation), `docs/14` (eval gate + adversarial QA), `docs/15` (roadmap order), `docs/17` (cost/routing), `docs/plans/security-vulnerabilities.md` (findings feed advisory).
