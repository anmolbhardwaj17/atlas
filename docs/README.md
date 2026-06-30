# Atlas — Engineering Blueprint (`/docs`)

> **Status:** All 19 documents at **v1.0**, complete and internally consistent (2026-06-30).
> **What this is:** the full design blueprint for **Atlas**, an AI-powered Engineering Intelligence Platform that builds a continuously-updated knowledge graph of a company's AWS + GitHub ecosystem and exposes it via visualization, search, and a cited AI interface.
> **New here? Read `00` first, then `02`. Building? Start at `PROJECT-BOARD.md`.**

> **The governing principle (P1):** *The knowledge graph is the product. The AI is the interface.* Every document ladders back to this.

---

## How to read these docs

- **Authoritative:** these docs are the source of truth. Code conforms to docs; if a contract must change, **the doc changes first** (`14` §19, `16` CS-8).
- **Internally cross-referenced:** documents cite each other and use **stable IDs** (see the key below) so a decision can be traced end-to-end.
- **Each doc follows one structure:** Purpose · Scope · Assumptions · Design Decisions (with *why*) · Risks · Alternatives · Edge Cases · Open Questions · References · Change log.

### ID convention key
| Prefix | Meaning | Defined in |
|---|---|---|
| `P1–P10` | Core principles | `00` §9 |
| `G1–G6` / `NG1–6` | Goals / Non-goals | `00` §3–4 |
| `A##` | Assumptions | per doc |
| `R##` / `*-R#` | Risks | per doc |
| `FR-x` / `NFR-x` | Functional / Non-functional requirements | `01` |
| `US-x` | User stories (+ Gherkin acceptance) | `01` §4 |
| `BR-x` | Business rules / invariants | `03` §6 |
| `DD-x` | Design decisions (with rationale) | every doc |
| `OQ-x` | Open questions (deferred decisions) | every doc |
| `EC-x` / `SEC-x` | Edge cases / security controls | per doc, `13` |

---

## Document index (reading order)

### 🧭 Foundation — vision → data (read in order)
| # | Doc | One-liner |
|---|---|---|
| 00 | [project-overview](00-project-overview.md) | Vision, goals/non-goals, principles **P1–P10**, personas A–E, success metrics, MVP |
| 01 | [product-requirements](01-product-requirements.md) | Full PRD: FR/NFR, **US-x with Gherkin acceptance**, MoSCoW priorities |
| 02 | [system-architecture](02-system-architecture.md) | Modular monolith + worker tier, 5 planes, tech choices & tradeoffs, sequence diagrams |
| 03 | [domain-model](03-domain-model.md) | Entities, aggregates, **BR-x invariants**, lifecycles, dual UUID+URN identity |
| 04 | [database-schema](04-database-schema.md) | Full PostgreSQL DDL, graph-shaped tables, RLS, migrations, graph-DB compatibility |
| 05 | [knowledge-graph](05-knowledge-graph.md) | URN grammar, edge-type catalog, **8 inference rules**, blast-radius traversal, confidence model |

### 🔌 Connectors — filling the graph
| # | Doc | One-liner |
|---|---|---|
| 06 | [aws-crawler](06-aws-crawler.md) | AWS read-only crawler, Connector SDK contract, service catalog, partial-sync safety |
| 07 | [github-crawler](07-github-crawler.md) | GitHub App crawler, webhooks, deploy inference, CODEOWNERS, dependencies |
| 07b | [bitbucket-crawler](07b-bitbucket-crawler.md) | **Phase-2 contingency** — Bitbucket as a delta-spec proving the connector abstraction |

### 🖥️ Interfaces — making it usable
| # | Doc | One-liner |
|---|---|---|
| 08 | [api-specification](08-api-specification.md) | REST contract, DTO strategy, SSE streaming, error model, OpenAPI, examples |
| 09 | [frontend-spec](09-frontend-spec.md) | Next.js + **shadcn/ui**, graph viz, the 4 UI states, certainty-visual-language, a11y |
| 10 | [ai-engine](10-ai-engine.md) | Retrieval-grounded AI, **7-layer hallucination prevention**, deterministic citations, MCP-future |
| 11 | [search-engine](11-search-engine.md) | OpenSearch hybrid (BM25+kNN), embeddings, projection-not-truth invariant |

### 🛡️ Platform — identity & safety
| # | Doc | One-liner |
|---|---|---|
| 12 | [authentication](12-authentication.md) | **Google-only login**, JWT/sessions, RBAC, `hd`-claim domain auto-join (Phase 1) |
| 13 | [security](13-security.md) | STRIDE threat model, IAM design, encryption, prompt-injection, the **Persona-E package** |

### 🚢 Delivery — building & running
| # | Doc | One-liner |
|---|---|---|
| 14 | [testing-strategy](14-testing-strategy.md) | Quality pyramid + **adversarial QA agent**, property/mutation testing, AI eval, DoD gates |
| 15 | [development-roadmap](15-development-roadmap.md) | Dependency-driven sprints, milestones, **Definition of Done**, MVP exit checklist |
| 16 | [coding-standards](16-coding-standards.md) | Gold standard: *make illegal states unrepresentable*, parse-don't-validate, shadcn-MCP workflow |
| 17 | [deployment](17-deployment.md) | Local dev, Fargate, CI/CD = the `14` gates, observability, DR centered on Postgres |

### 💼 Business
| # | Doc | One-liner |
|---|---|---|
| 18 | [business-model](18-business-model.md) | ICP, seat+footprint+AI pricing, PLG+security-gated GTM, competitive moat |

---

## Dependency / cross-reference map

```mermaid
flowchart TB
    00 --> 01 --> 02
    02 --> 03 --> 04 --> 05
    05 --> 06 & 07
    07 --> 07b
    04 & 05 --> 08
    08 --> 09 & 10 & 11
    02 --> 12 --> 13
    03 -.-> 12
    06 & 07 & 10 & 12 --> 13
    01 --> 14
    02 -.everything.-> 14
    14 --> 15
    02 --> 16
    02 & 13 & 14 & 16 --> 17
    00 & 13 & 15 & 17 --> 18
    classDef found fill:#e8f0ff; classDef build fill:#eafaea;
    class 00,01,02,03,04,05 found
    class 14,15,16,17 build
```

*Read it as: a document builds on those pointing into it. The foundation (00–05) and graph design underpin everything; security (13) ties together the connectors/AI/auth; delivery (14–17) operationalizes the whole.*

---

## Where to start, by role

| You are… | Start with |
|---|---|
| A **new engineer / AI agent** building this | `CLAUDE.md` (root) → `PROJECT-BOARD.md` → `00`, `02`, `16`, then the doc for your task |
| A **security reviewer** (Persona E) | `13` (security) → `12` (auth) → `06`/`07` (read-only connectors) |
| A **founder / GTM** | `00` (vision) → `18` (business) → `15` (roadmap) |
| **Building a specific feature** | `PROJECT-BOARD.md` for the task → its linked doc(s) → `08` (API) + `16` (standards) |

---

## Live working files (not specs)
- **[`PROJECT-BOARD.md`](PROJECT-BOARD.md)** — the Jira-lite task board + activity log. *Where we are, what's next, what's done.*
- **`../CLAUDE.md`** — the session operating manual (rules + start protocol).
