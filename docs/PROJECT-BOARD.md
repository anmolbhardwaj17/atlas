# Atlas — Project Board

> **The single source of truth for "where we are."** Update this whenever a task changes status or work happens.
> Use the **`/board`** skill to update consistently. Last updated: **2026-06-30**.

**Status legend:** 📋 Todo · 🔵 In Progress · 🔍 Review · ✅ Done · ⛔ Blocked · ⏸️ Deferred (Phase-1+)

---

## 📍 YOU ARE HERE

> **Blueprint phase complete.** All 19 design docs are written (v1.0). Continuity scaffolding (this board, README, CLAUDE.md, memory, skills) is being set up.
> **Next milestone:** begin the build at **Sprint F1 — Foundation** (auth + tenancy + CI gates). Nothing is coded yet.
> **Suggested next action:** decide whether to `git init` the repo, then scaffold the monorepo per `docs/16` §2 and start F1.

**Progress at a glance**
- 📘 Blueprint (docs): **19 / 19 ✅ (100%)**
- 🧰 Project setup: **✅ done** (CLAUDE.md, README, board, skills, memory, git+GitHub)
- 🏗️ Build: **F1 in progress** — F1.1 scaffold ✅, F1.2 CI ✅, F1.3 app shells ✅; next **F1.4** (Google OAuth login + sessions/JWT)

---

## How to use this board (for future-me)
- Each **Epic** = a phase from `docs/15`. Each **Task** has an ID, Status, linked doc(s), and a **Status note** (the latest comment on it).
- When you work: set the task 🔵, leave a Status note, and **append a dated entry to the Activity Log** at the bottom.
- When done: set ✅, note what "done" means (which `docs/15` Definition-of-Done gates passed).
- Keep tasks small enough to reason about; add sub-tasks under a sprint as you start it.

---

## EPIC 0 — 📘 Blueprint / Documentation — ✅ DONE
*All design docs written, internally consistent, v1.0. See `docs/README.md`.*

| ID | Doc | Status | Note |
|---|---|---|---|
| DOC-00 | project-overview | ✅ | Vision, P1–P10, personas, metrics |
| DOC-01 | product-requirements | ✅ | FR/NFR/US + Gherkin |
| DOC-02 | system-architecture | ✅ | Modular monolith + workers, 5 planes |
| DOC-03 | domain-model | ✅ | Entities, BR-x, dual identity |
| DOC-04 | database-schema | ✅ | PG DDL, RLS, migrations; +Phase-1 auth tables |
| DOC-05 | knowledge-graph | ✅ | URN, edges, 8 inference rules, confidence |
| DOC-06 | aws-crawler | ✅ | Connector SDK, service catalog, partial-sync |
| DOC-07 | github-crawler | ✅ | App, webhooks, deploy inference |
| DOC-07b | bitbucket-crawler | ⏸️ | Phase-2 contingency (design only) |
| DOC-08 | api-specification | ✅ | REST, DTOs, SSE, OpenAPI; +Google/domain endpoints |
| DOC-09 | frontend-spec | ✅ | Next.js + shadcn, viz, 4 states, a11y |
| DOC-10 | ai-engine | ✅ | Grounded, cited, 7-layer anti-hallucination |
| DOC-11 | search-engine | ✅ | OpenSearch hybrid, embeddings |
| DOC-12 | authentication | ✅ | Google login, RBAC, hd-domain join (Phase-1) |
| DOC-13 | security | ✅ | Threat model, IAM, Persona-E package |
| DOC-14 | testing-strategy | ✅ | Pyramid + adversarial QA agent, DoD gates |
| DOC-15 | development-roadmap | ✅ | Sprints, DoD, MVP checklist |
| DOC-16 | coding-standards | ✅ | Gold standard, parse-don't-validate, shadcn-MCP |
| DOC-17 | deployment | ✅ | Fargate, CI/CD, DR |
| DOC-18 | business-model | ✅ | Pricing, GTM, moat |

---

## EPIC SETUP — 🧰 Project Continuity Scaffolding — ✅ DONE
*Make any future session instantly resumable (this session's work).*

| ID | Task | Status | Note |
|---|---|---|---|
| SET-1 | Root `CLAUDE.md` (rules + session protocol) | ✅ | Auto-loads every session |
| SET-2 | `docs/README.md` (index + cross-ref map) | ✅ | Navigation for all 19 docs |
| SET-3 | `docs/PROJECT-BOARD.md` (this board) | ✅ | Jira-lite tracking + activity log |
| SET-4 | Skills: `/resume`, `/board`, `/atlas-doc` | ✅ | In `.claude/skills/` |
| SET-5 | Memory files (decisions, state, prefs) | ✅ | 5 files + `MEMORY.md` in project memory dir |
| SET-6 | `git init` + GitHub remote | ✅ | Repo `atlas` on `main`; **private** GitHub remote `anmolbhardwaj17/atlas` pushed. |

---

## EPIC F — 🏗️ Foundation — 🔵 IN PROGRESS  *(walking skeleton + safety rails, `docs/15` Phase F)*

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| F1.1 | Monorepo scaffold + shared tooling + `config` package | ✅ | 16 §2/§4, 17 §6 | pnpm workspaces + strict TS + eslint(no-any) + prettier + vitest. `@atlas/config` (Zod env, parse-don't-validate). **All gates green: format/lint/typecheck/6 tests.** |
| F1.2 | CI gate harness (lint/typecheck/test) | ✅ | 14 §16, 17 §5 | GitHub Actions `.github/workflows/ci.yml`: pnpm + Node 22, format/lint/typecheck/test on push to main + PRs. **First run green (22s).** Badge on README. Heavier stages (integration/contract/adversarial-QA/E2E/load) added in later sprints. |
| F1.4 | DB foundation: Postgres + Kysely + migrations + core tables + RLS | 📋 | 04, 13 §6, 17 | **NEXT.** Kysely + SQL migrations; tables organizations/users/auth_identities/memberships/invitations; GUC-RLS (`atlas.current_org`); restricted app role. Standard Postgres → runs on Supabase. Verify isolation vs local/throwaway Postgres. |
| F1.5 | Supabase Auth (Google) integration + session/JWT verify | 📋 | 12 | Supabase-hosted Google login; NestJS verifies Supabase JWT (JWKS); mirror `users` from `auth.users`. **Rewrite `docs/12` §2–3 first.** |
| F1.6 | Org / RBAC / memberships / invitations (endpoints + guards) | 📋 | 12, 03, 08 | tenant-scope guard sets the GUC |
| F1.7 | Tenant-isolation test (US-12 foundation) | 📋 | 04 §10, 13 §6 | RLS cross-org test; expands to graph in G sprints |
| F1.3 | App shells: NestJS API + Next.js web + Turborepo | ✅ | 02, 09, 16, 17 | `apps/api` (Nest+Fastify, `/health` ✅ boots) + `apps/web` (Next 15/React 19 shell) + Turborepo build orchestration. `@atlas/config` now builds to CJS, consumed by API at runtime. All gates green. **Note:** full structured-logging/correlation-id observability package deferred to a follow-up (basic Nest logger for now). |
| F2 | Connector SDK interface + queue/worker/scheduler | 📋 | 06 §3, 02 §5 | BullMQ, the fork point |
| F2 | Secrets Broker + Secrets Manager | 📋 | 13 §7 | |
| F2 | Connections + sync_runs lifecycle + S3 snapshots | 📋 | 03, 04, 08 §8 | |

**Exit (M0):** Google login → create org → invite Member; US-12 + RLS pass; CI green; deploys to staging.

---

## EPIC I — 📥 Ingest — 📋 TODO  *(fill the graph; I1 ∥ I2 after F2)*

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| I1 | AWS crawler (AssumeRole, service catalog, full+incremental, degraded) | 📋 | 06, 13 §4 | parallel with I2 |
| I2 | GitHub crawler (App, webhooks, deploy signals, CODEOWNERS, deps) | 📋 | 07, 13 §5 | parallel with I1 |

**Exit (M1):** real AWS+GitHub → nodes + provenance; degraded reports missing perms; no false deletes.

---

## EPIC G — 🧠 Graph & Intelligence — 📋 TODO

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| G1 | Inference engine + rules R1–R8 + atlas.service | 📋 | 05 | **precision ≥95%**, deterministic |
| G2 | Read API + traversals (blast-radius/deps) + OpenSearch hybrid search | 📋 | 08 §9, 11 | unblocks G3/G4 |
| G3 | AI engine (planner, grounding gate, cited, streamed, eval in CI) | 📋 | 10, 14 §11 | hallucination <1% |
| G4 | Explore UI + graph canvas + detail + 4 states | 📋 | 09 | parallel with G3 |

**Exit (M2–M5):** cross-source cited edges; canonical questions answered correctly & honestly; explorable.

---

## EPIC P — ✨ Polish — 📋 TODO

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| P1 | Onboarding wizard + AI chat surface + timeline + settings | 📋 | 09 §8 | hit **TTFI < 30 min** |
| P2 | Hardening: load/perf (NFR), security pass, observability, DR drill, mutation tests | 📋 | 14, 13, 17 | MVP exit checklist |

**Exit (M6–M7):** NFR targets met; security suite green; DR drill passes.

---

## EPIC GA — 🚀 Launch — 📋 TODO

| ID | Task | Status | Docs | Note |
|---|---|---|---|---|
| GA | Closed beta → fix activation → security package → GA | 📋 | 18, 13, 15 | design partners validate trust ≥90% |

---

## ⏸️ Backlog (Phase-1+ — deferred, from roadmap `docs/15` §8)
- v1.1 Trust & Depth: richer inference, culprit-PR ranking (US-6), saved views/deep-links
- v1.2 Enterprise on-ramp: multi-account AWS, **domain auto-join (`hd`)**, real-time CloudTrail ingestion
- v1.3 Enterprise security: SSO/SAML+SCIM, custom RBAC, SOC 2 Type II, data residency
- v2.0 Breadth: GCP/Azure, **Bitbucket (`07b`)/GitLab**, Datadog/PagerDuty
- v2.x Scale: dedicated graph DB (when `05` DD-3 trigger met), partitioning
- v3.0 Platform: proactive alerts, incident root-cause, **MCP/public API**, connector marketplace

---

## 📜 Activity Log (append newest at top; one line per work session/event)

| Date | Who | What |
|---|---|---|
| 2026-06-30 | architect | **Decision: adopt Supabase** (managed Postgres + Auth/Google + Storage). Backend/graph/AI unchanged; keep GUC-RLS isolation. Recorded in CLAUDE.md + memory; banners added to docs 02/04/12/13/17. Reordered F1 to DB-first. |
| 2026-06-30 | architect | **F1.3 ✅** — NestJS API shell (Fastify, `/health` boots OK) + Next.js 15 web shell + Turborepo build orchestration. `@atlas/config` → CJS dist consumed at runtime. All gates green. |
| 2026-06-30 | architect | **F1.2 ✅** — GitHub Actions CI (`ci.yml`) running format/lint/typecheck/test on push to main. First run green (22s). README badge added. |
| 2026-06-30 | architect | Adopted **main-only git workflow** (no branches/PRs yet; `dev` later). Cleaned history to 2 commits, no AI attribution. F1.1 on `main`. |
| 2026-06-30 | architect | **F1.1 ✅** — monorepo scaffold (pnpm workspaces, strict TS, eslint/prettier, vitest) + `@atlas/config` (Zod env). All gates green. |
| 2026-06-30 | architect | Pushed to **private** GitHub remote `anmolbhardwaj17/atlas`. |
| 2026-06-30 | architect | `git init` (repo `atlas`, branch `main`); initial commit `ec99660` with blueprint + scaffolding (28 files). SET-6 ✅. |
| 2026-06-30 | architect | Set up continuity scaffolding: CLAUDE.md, docs/README.md, this board, skills, memory (EPIC SETUP). |
| 2026-06-30 | architect | Completed full blueprint: wrote all 19 design docs `00`–`18` + `07b` (EPIC 0 ✅). |
| 2026-06-30 | architect | Interactive decisions captured: Bitbucket=Phase-2, Google-only auth + `hd` domain-join Phase-1, shadcn+MCP, adversarial QA agent. Propagated across 00/01/03/04/08/09/12/16. |
