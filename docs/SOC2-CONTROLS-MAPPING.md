# Atlas — SOC 2 Controls Mapping

> **Purpose.** Map Atlas's **technical/product controls** to the SOC 2 **Trust Services Criteria (TSC)** so a compliance lead, an automation tool (Vanta/Drata/Secureframe), or an auditor can see, with evidence, which criteria the product already satisfies — and which require **organizational** controls (policies, process, people, evidence-over-time) that code alone can't provide.
>
> **Read this first — the honest framing.** SOC 2 is an **attestation of your organization**, not a property of the codebase. This document covers the part auditors probe first (the technical controls), which are strong. It is **not** a readiness assessment or a substitute for an auditor. The org-side controls in §4 are required and are *not* built by the product.
>
> **Scope of this mapping:** the Atlas platform (`apps/api`, `apps/web`, `packages/*`) and its data plane (Supabase Postgres + Storage, AWS hosting). **Trust Services Categories addressed:** **Security** (Common Criteria, mandatory), **Confidentiality**, and **Privacy**; **Availability** and **Processing Integrity** are partially evidenced and flagged.
> **Last updated:** 2026-07-15. Derived from the 2026-07-15 compliance audit; commits referenced are on `main`.

---

## 1. Legend

| Mark | Meaning |
|---|---|
| **P** | **Product control** — enforced in code/architecture; evidence is in-repo. |
| **P+O** | Product control that also needs an **organizational** policy/process wrapper to satisfy the criterion. |
| **O** | **Organizational** control — policy/process/evidence, **not** in the product. Listed so nothing is missed. |

Evidence is cited as `path` (source) or *architecture* (design fact). "Verified" = confirmed against source in the 2026-07-15 audit.

---

## 2. Common Criteria (Security) — CC1–CC9

### CC1 — Control Environment (governance, ethics, org structure)
| # | Criterion (paraphrased) | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC1.1–1.5 | Integrity/ethics, board oversight, org structure, competence, accountability | Company policies, org chart, code of conduct, defined security roles | **O** | *Org — not in product. Needed for certification.* |

### CC2 — Communication & Information
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC2.1 | Quality information for internal control | Structured JSON access logs + request correlation ids threaded through logs/responses/audit | **P** | `apps/api/src/common/logging.interceptor.ts`, `apps/api/src/main.ts` (x-request-id) |
| CC2.2–2.3 | Internal/external comms of responsibilities | Security page / trust content, customer-facing docs, internal runbooks | **O** | *Org — trust page + policies.* |

### CC3 — Risk Assessment
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC3.1–3.4 | Objectives, risk identification, fraud, change risk | Formal risk assessment + risk register; threat model | **P+O** | Product invariants exist (BR-x rules, `docs/03`, `docs/13`); a **documented risk assessment** is **O**. |

### CC4 — Monitoring Activities
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC4.1 | Ongoing/separate evaluations | Health polling, proactive incident detection, self-healing sync reaper | **P** | `apps/api/src/connections/health-poller.bootstrap.ts`, `incidents/proactive-incidents.service.ts` |
| CC4.2 | Evaluate & communicate deficiencies | Append-only audit log; alerting (Slack/Discord/Teams/email) | **P+O** | `apps/api/src/core/audit.service.ts` + notifications; **management review of findings** is **O**. |

### CC5 — Control Activities
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC5.1–5.3 | Controls, tech controls, policy deployment | The technical controls in CC6–CC8; CI quality gates enforce policy-as-code | **P** | CI: format+lint(no-`any`)+typecheck+test+**Postgres-RLS integration**+prod-build (`docs/14`, `docs/16`) |

### CC6 — Logical & Physical Access **(the core, strongest area)**
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC6.1 | Logical access security (identify/authenticate) | **Global authentication by default** — every route requires a valid Supabase ES256 JWT (JWKS-verified, alg-pinned, iss/aud/exp checked) unless explicitly `@Public()` | **P** | `apps/api/src/auth/auth.guard.ts` (global APP_GUARD), `supabase-jwt.verifier.ts`, `public.decorator.ts` · commit `2feaabf` (verified live: public 200 / protected 401) |
| CC6.1 | Least privilege / RBAC | Role hierarchy Owner>Admin>Member; destructive/config ops require Admin/Owner; hierarchy enforced + tested | **P** | `apps/api/src/auth/roles.guard.ts` (+ `roles.guard.test.ts`); per-endpoint `@Roles` |
| CC6.1 | **Tenant isolation** (multi-tenant access boundary) | 3 layers: restricted `atlas_app` role (NOLOGIN NOBYPASSRLS) + composite FKs + RLS on every table via `atlas.current_org` GUC; cross-tenant → **404 not 403**; boot assertion refuses SUPERUSER/BYPASSRLS | **P** | `packages/db/src/client.ts` (withOrgScope + assertRestrictedRole), `0002_rls.ts`, `tenant-scope.guard.ts`; *audit: RLS present on all 32 tables, no leak* |
| CC6.1 | Data at rest — secrets encryption | Customer credentials + BYO-LLM keys **AES-256-GCM**, key from `SECRET_ENCRYPTION_KEY` env (never in DB), fail-closed decrypt, opaque `secret_ref`; **fail-fast if key unset in prod** | **P** | `packages/ingest/src/secret-broker.ts`, `0018_connection_secrets.ts` · digest fail-fast `842e23a` |
| CC6.1 | Data at rest — DB/storage encryption | Supabase-managed Postgres + Storage encryption at rest | **P+O** | *Provider (Supabase) — confirm in their SOC 2 + your config.* |
| CC6.6 | Boundary protection / external threats | SSRF-safe outbound webhook validation (parse host, not regex); connector SSRF guards (Jira/Jenkins/Bitbucket); locked CORS to the web origin | **P** | `notifications/notification.service.ts` (`isWebhookUrl`, commit `4c7819f`), `main.ts` (CORS), connector ssrf-guards |
| CC6.7 | Data in transit | HSTS + nonce-based CSP + nosniff/frame/referrer (web); nosniff/frame/referrer (API); TLS terminated at the edge | **P+O** | `apps/web/src/middleware.ts` (CSP nonce, commit `62d0b75`), `apps/web/next.config.mjs`, `apps/api/src/main.ts`; edge TLS config is **O** (`docs/17`) |
| CC6.7 | Read-only by construction (no write access to customer systems) | **Zero** mutating AWS SDK commands in the connectors; read-only GitHub scopes; recommended IAM is ReadOnlyAccess/SecurityAudit; AssumeRole + ExternalId, temp creds ≤1h in-memory | **P** | `packages/connector-aws/*` (audit: no Create/Put/Delete/Modify commands), `permissions.ts`, `credentials.ts` |
| CC6.2–6.3 | Provisioning/deprovisioning access | Membership invite/revoke/role-change flows (in-product); **HR-driven onboarding/offboarding + periodic access reviews** | **P+O** | `apps/api/src/orgs/*`; access reviews + offboarding evidence are **O** |
| CC6.4–6.5 | Physical access; media disposal | Cloud provider (AWS/Supabase) responsibility | **O** | *Inherited from provider SOC 2.* |

### CC7 — System Operations
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC7.1 | Detect config changes / vulnerabilities | Change timeline (`node_events`), dependency-vuln intelligence (OSV), cloud posture rules | **P** | `packages/ingest/src/osv-enrichment.ts`, inference R16/posture, `docs/plans/security-vulnerabilities.md` |
| CC7.2 | Monitor anomalies | Health polling + proactive incident detection + War Room diagnosis | **P** | `incidents/*`, `docs/plans/war-room.md` |
| CC7.3–7.4 | Incident response & recovery | Incident detection + notification exists; a **documented IR plan, on-call, post-mortems** are needed | **P+O** | Product: notifications/War Room. Plan/runbook/evidence: **O** |
| CC7.5 | Recovery / backups | Supabase managed Postgres PITR; app is stateless | **P+O** | *Provider PITR + a documented DR drill (**O**, `docs/17`).* |

### CC8 — Change Management
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC8.1 | Authorize/design/test/approve changes | Forward-only transactional migrations; CI gates on every push (types/lint/test/RLS/build); conventional commits; docs-as-contract | **P+O** | `packages/db/src/migrate.ts`, `docs/14`, `docs/16`; **branch protection + PR review policy** is **O** (currently trunk-based per project rules) |

### CC9 — Risk Mitigation
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| CC9.1 | Risk mitigation activities | Read-only design, tenant isolation, encryption, retention limit blast radius | **P** | see CC6 |
| CC9.2 | **Vendor / sub-processor management** | Sub-processors disclosed (Supabase, AWS, Anthropic, Resend); BYO-LLM path documented | **P+O** | `apps/web/src/app/legal/privacy` (§5). **Vendor DDQ, DPAs, and a sub-processor register** are **O**. |

---

## 3. Confidentiality & Privacy categories

### Confidentiality (C1)
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| C1.1 | Identify/maintain confidential info | Data classification (C-tiers) in `docs/13`; tenant isolation + encryption confine it | **P+O** | `docs/13` §data-classes; enforcement per CC6 |
| C1.2 | Dispose of confidential info | **Erasure on disconnect/org-delete** (rows + Storage blobs + credential); **retention sweep** purges aged data | **P** | `connection.service.ts`/`org.service.ts` (`08be3f1`, `a7472d3`), retention `app_purge_expired` (`7c9ade3`) |

### Privacy (P1–P8, if the Privacy category is in scope)
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| P1–P2 | Notice & choice/consent | Privacy policy (draft, aligned to reality) + email-preference opt-outs | **P+O** | `app/legal/privacy` (`61e2c87`), `notifications/email-prefs`; **legal finalization is O** |
| P3–P4 | Collection & use limitation; data minimization | Read-only metadata only; CODEOWNERS drops raw emails; LLM context minimized/bounded; no full source stored | **P** | connectors + `docs/13` SEC-10; `packages/ai/src/context.ts` bounds |
| P5 | Retention & disposal | Retention sweep (30/90/365d windows) + erasure paths | **P** | `0058_retention.ts`, `0059_erased_identities.ts` |
| P6 | **Access — data-subject access** | **DSAR export** (members + ingested identities) | **P** | `GET /orgs/:id/data-export` (`c167738`), Privacy & data settings card |
| P6 | **Access — data-subject erasure** | **Per-person erasure**, durable (re-applied after each sync so a re-crawl can't undo it) | **P** | `POST /people/:id/erase` (`03143a1`), `erased_identities` |
| P7 | Disclosure to third parties | Sub-processors named + BYO-LLM disclosed; PII-to-AI disclosed | **P+O** | privacy §5–6; DPAs/SCCs are **O** |
| P8 | Quality; monitoring & enforcement | Provenance on every claim (P4); audit log; honest "not assessable"/"I don't know" states | **P+O** | `docs/05`/`docs/10`; **a privacy-complaint process is O** |

### Availability (A1) — partial
| # | Criterion | Atlas control | Type | Evidence |
|---|---|---|---|---|
| A1.1–A1.3 | Capacity, backups, recovery | Managed Postgres PITR, stateless app, durable rate limiting, self-healing sync reaper; **SLAs, DR drill, capacity plan are O** | **P+O** | `core/rate-limit.service.ts`, sync reaper; DR/SLA **O** |

---

## 4. Organizational controls still required (NOT product — do these for certification)

These are the gap between "strong technical posture" and "certified." A compliance-automation tool + an auditor drive most of them.

1. **Security policies** — access control, encryption, data classification/handling, incident response, change management, business continuity/DR, vendor management, acceptable use, SDLC.
2. **Access reviews** — periodic (e.g. quarterly) review of who has access to production, the DB, cloud accounts, and this repo; documented onboarding/offboarding.
3. **Risk assessment** — a documented, periodically-reviewed risk register + threat model.
4. **Vendor management** — DDQ + DPA + a maintained sub-processor register for Supabase, AWS, Anthropic, Resend (+ any BYO providers); confirm each has its own SOC 2 / equivalent.
5. **Penetration test** — an independent annual pen test (and remediation evidence).
6. **Incident response** — a written IR plan, on-call rotation, and post-mortem process, with at least one tabletop/exercise.
7. **Change management evidence** — PR review + branch protection policy (note: the project currently works trunk-based on `main`; an auditor will want a documented change-approval control) and a change log.
8. **HR controls** — background checks, security-awareness training, confidentiality agreements.
9. **BCP / DR drill** — a documented and *tested* recovery procedure.
10. **Evidence collection over the observation window** — via a tool (Vanta/Drata/Secureframe) wired to GitHub/AWS/Supabase/HR for continuous control evidence.
11. **A monitored security/privacy contact** — replace `privacy@atlas.example`.

---

## 5. Readiness snapshot (indicative, not an assessment)

| Area | Product controls | Org controls |
|---|---|---|
| Logical access / isolation (CC6) | 🟢 Strong, verified | 🟠 Access reviews, onboarding/offboarding |
| Encryption & secrets | 🟢 Strong | 🟠 Confirm provider config + key management policy |
| Change management (CC8) | 🟢 CI gates, migrations | 🟠 PR-review/branch-protection policy + evidence |
| Monitoring & incident (CC4/CC7) | 🟢 Health/incident/audit | 🔴 Written IR plan + reviews |
| Risk & governance (CC1/CC3) | 🟡 Invariants in design | 🔴 Policies, risk register, HR controls |
| Vendor mgmt (CC9) | 🟡 Sub-processors disclosed | 🔴 DDQ/DPA/register |
| Confidentiality & Privacy | 🟢 Erasure/retention/DSAR | 🟠 Legal finalization + privacy process |

> **Bottom line:** the **product** is most of the way to the Security/Confidentiality/Privacy technical bar. The remaining work to a SOC 2 report is **organizational** (§4) + an observation window + an auditor. Recommended: adopt a compliance-automation tool, close its checklist, then Type I → Type II.

---

## 6. Other frameworks (applicability)

- **ISO 27001** — an ISMS certification; ~80% of the technical work overlaps SOC 2. Adds a Statement of Applicability (Annex A), internal audits, management review. Pursue for international/enterprise after SOC 2.
- **HIPAA** — applies **only if Atlas processes PHI**. Atlas maps infra/code metadata, not patient data, so it normally does not. If a healthcare customer requires it: sign a BAA with the customer **and** with each sub-processor that could touch PHI (AWS/Supabase offer BAAs — **confirm Anthropic's**). Controls overlap SOC 2 Security.
- **CMMC** — applies **only if selling to the US DoD** (FCI/CUI, NIST 800-171). Hard data-residency + US-persons requirements; the current **Sydney** hosting disqualifies CUI handling without a US-region program. Treat as a major infra effort, not a checkbox.

---

## 7. Cross-references
- **Security design:** `docs/13-security.md` · **Auth:** `docs/12` · **DB/RLS:** `docs/04` · **Testing/QA gates:** `docs/14`
- **Privacy policy (draft):** `apps/web/src/app/legal/privacy/page.tsx`
- **Compliance-fix history:** `docs/PROJECT-BOARD.md` (2026-07-15 entries) · **Product state:** `docs/PRD.md`
