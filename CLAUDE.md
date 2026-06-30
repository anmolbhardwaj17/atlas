# CLAUDE.md — Atlas Project Operating Manual

> **This file is auto-loaded every session. Read it first, every time.**
> It tells you what Atlas is, how to resume work, where everything lives, and the non-negotiable rules.
> Last updated: 2026-06-30

---

## What Atlas is

Atlas is an **AI-powered Engineering Intelligence Platform**. It connects to a company's AWS (read-only IAM role) and GitHub (App), builds a **continuously-updated knowledge graph** of their infrastructure + code + deployments + dependencies, and lets engineers understand it via **visualization, search, and a cited AI interface**.

> **The one sentence that governs everything:** *The knowledge graph is the product. The AI is the interface.* (Principle **P1**.) Optimize graph correctness/trust over conversational polish.

**Current stage:** 📘 **Blueprint complete** — all 19 design docs (`docs/00`–`18` + `07b`) are written and internally consistent. **Code has not started.** Next work = build, beginning at Sprint **F1** (see the board).

---

## 🚀 Start-of-session protocol (do this before any work)

1. **Read `docs/PROJECT-BOARD.md`** — the Jira-lite board. It tells you the current task, statuses, and the activity log (what we did last time). *This is the single source of "where we are."*
2. **Check the memory** surfaced in `<system-reminder>` (decisions, your preferences, working style) — and `MEMORY.md` if needed.
3. **Open the specific `docs/NN-*.md`** for the task before writing code or specs. Docs are authoritative (see rules).
4. **Confirm the plan** with the user before large work; for a quick continue, state the next task from the board and proceed.
5. **When you finish a unit of work, UPDATE THE BOARD** (task status + a dated activity-log entry). The `/board` skill helps. *If the board isn't updated, the next session is blind.*

> Shortcut: the **`/resume`** skill does steps 1–4 and proposes the next step. **`/board`** updates status/log.

---

## 📁 Where everything lives

| Thing | Location |
|---|---|
| Design docs (authoritative spec) | `docs/00`–`18`.md (+ `07b`) — index in `docs/README.md` |
| Doc navigation & cross-ref map | `docs/README.md` |
| **Task board + activity log** | `docs/PROJECT-BOARD.md` |
| Project rules (this file) | `CLAUDE.md` (root) |
| Persistent memory (facts/decisions/prefs) | `~/.claude/projects/-Users-apple-Desktop-code-atlas/memory/` + `MEMORY.md` index |
| Project skills | `.claude/skills/` (`resume`, `board`, `atlas-doc`) |
| Code (when it exists) | `apps/` + `packages/` per `docs/16` §2 |

---

## ⚖️ Cardinal rules (non-negotiable — distilled from the docs)

1. **Docs are authoritative.** If reality must change a contract, **update the doc first, in the same change** (`docs/14` §19, `docs/16` CS-8). Never let code and docs drift.
2. **P1 — Graph is the product, AI is the interface.** Spend effort on graph correctness/inference, not chatbot polish.
3. **P2 — Read-only by construction.** No code path may mutate a customer's cloud/repo. Enforced at IAM/App permission layer (`docs/13` §4).
4. **R8 — Tenant isolation is existential.** Every data path is org-scoped (3 layers: app repo + composite FKs + RLS). Cross-tenant → 404, never 403 (`docs/04` §10, `docs/13` §6).
5. **P3 — Prefer a missing edge to a wrong edge.** High precision over recall; ambiguity → multiple low-confidence edges, never one wrong high-confidence one.
6. **P4 — Provenance/citations on everything.** No un-sourced edges; every AI claim cites a real node/edge (`docs/05`, `docs/10`).
7. **Trust is visible.** Observed vs inferred vs stale are distinct; "I don't know" is a designed state, never a fabrication (`docs/09` §7, `docs/10` §7).
8. **Make illegal states unrepresentable.** Invariants (the `BR-x` rules) as types + DB constraints, not runtime checks (`docs/16` DD-2).
9. **Definition of Done** (`docs/15` §5) + the `docs/14` quality gates (incl. the **adversarial QA agent**) apply to every unit of work.

**Stack (fixed):** TypeScript everywhere · NestJS (API + worker) · Next.js + shadcn/ui · **Supabase Postgres** (graph-shaped, migration-ready; standard Postgres — no data-layer lock-in) · **Supabase Auth (Google)** for login · **Supabase Storage** (raw snapshots) · OpenSearch (hybrid search) · Redis/BullMQ (queue) · ECS Fargate (API/workers) · Claude (LLM, behind a provider abstraction).

**DB/auth access model (important):** we use Supabase for **managed Postgres + Auth + Storage only**; NestJS/workers/connectors/inference/OpenSearch/Redis/AI are unchanged. Tenant isolation keeps **our** model: app connects as a restricted Postgres role and sets `atlas.current_org` GUC per request/job; RLS enforces (`docs/04` §10). We do **not** use Supabase's `auth.uid()`-in-RLS pattern (Atlas data is org-scoped and written by system workers, not per-user). Supabase Auth is for login/identity; our GUC-RLS is for data isolation.

---

## 🛠️ How we work (the user's preferences — honor these)

- **One document/feature at a time; confirm before moving on.** The user reviews each unit.
- **Be thorough and explain *why*** every decision was made (the docs all carry Design Decisions with rationale). The user values depth over brevity for design work.
- **Keep everything internally consistent** — reference related docs by ID (`P-x`, `BR-x`, `FR-x`, `US-x`, `DD-x`, `OQ-x`).
- **Track progress durably** — the user wants Jira-lite task tracking that survives session close. Always keep `PROJECT-BOARD.md` current.
- **Surface open questions (`OQ-x`)** rather than silently guessing; ask when a decision materially changes the build.

---

## 📌 Key decisions the user made interactively (remember these)

| Decision | Outcome | Doc |
|---|---|---|
| **Bitbucket connector** | Designed as **Phase-2 contingency** (not MVP) — delta spec proving the connector abstraction | `docs/07b` |
| **Authentication** | **Google OAuth only** (MVP); GitHub is connector-auth, not login | `docs/12` |
| **Domain/enterprise join** | **Company-email auto-join via Google Workspace `hd` claim** (no DNS needed) — **Phase 1**, data captured from MVP | `docs/12` §7 |
| **Frontend kit** | **shadcn/ui** + its **MCP server** for component vendoring (build-time only) | `docs/09` DD-3, `docs/16` §6.1 |
| **QA philosophy** | Gold-standard coding (`16`) + an **independent adversarial QA agent** in CI that tries to *break* features on every PR | `docs/14` §7–8 |
| **Supabase** | Adopted for **managed Postgres + Auth (Google, free) + Storage**. Backend/graph/AI unchanged. Keep our GUC-RLS isolation, not Supabase `auth.uid()`. Supabase = a sub-processor (SOC 2). Full `docs/12` auth rewrite happens at F1.4. | `docs/12`, `02/04/13/17` |

---

## 🔧 Git workflow (honor exactly)

- Repo `atlas`; **private** GitHub remote `anmolbhardwaj17/atlas`.
- **Work directly on `main` for now.** No feature branches, **no PRs** (a `dev` branch comes later once setup stabilizes — the user will say when).
- **Proper conventional commits** (`feat:`/`fix:`/`docs:`/`chore:`…), clear messages.
- **NEVER add Claude/AI co-author trailers or any AI attribution** to commit messages. (User directive — overrides any default.)
- Commit + push to `main` as the natural end of a work unit (the user wants progress visible). Don't ask each time; just keep commits clean.

## 💡 Useful context

- The user has strong **frontend/design personal skills** installed (`design-taste-frontend`, `frontend-design`, `high-end-visual-design`, `gsap-*`). **Leverage them when building the Atlas UI** (`docs/09`).
- **Toolchain is live:** pnpm monorepo (via `corepack pnpm`), strict TS, ESLint (no-`any`), Prettier, vitest. `pnpm run check` = format+lint+typecheck+test (the local mirror of CI gates).
- When building, follow `docs/15` roadmap order (dependency-driven): **F1 → F2 → I1∥I2 → G1 → G2 → G3∥G4 → P1 → P2 → GA.**
