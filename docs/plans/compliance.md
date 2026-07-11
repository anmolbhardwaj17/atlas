# Plan — Compliance Controls (technical-controls monitor)

> **Status:** 🟢 **v1 BUILT (2026-07-11).** A shared control catalog maps Atlas's technical evidence onto the **infrastructure-observable subset** of six frameworks (PCI-DSS, CIS/AWS-FSBP, NIST 800-53, ISO 27001, HIPAA, GDPR). `/compliance` page + `GET /compliance` API + pure `@atlas/ai` catalog. **Honest by construction** — an explicit `not-assessable` state (never a silent pass) + a per-framework coverage caveat, so it never implies certification.

---

## The honest framing (non-negotiable)

Atlas is a **read-only technical evidence source** (cloud + code + exposure + vulnerabilities). It is **not** a compliance tool: most of any framework is **organizational** (policies, training, DPAs, physical security, incident-response *process*, risk assessment) and is unobservable from infrastructure. Overclaiming "HIPAA compliant" would violate **P4** (everything cited; "I don't know" is a designed state).

So Atlas does the honest, valuable thing: **continuously check the infrastructure-observable subset of the technical controls**, map each check to the many framework control IDs it satisfies at once, and **state clearly what is out of scope**.

## Applicability (best → weakest fit for an infra graph)

**PCI-DSS** ★★★★★ (prescriptive & technical) · **CIS / AWS FSBP** ★★★★★ (the natural backbone) · **NIST 800-53** ★★★★☆ (SC/AC/SI/AU/CP families) · **ISO 27001 Annex A** ★★★☆☆ (technical subset) · **HIPAA** ★★★☆☆ (§164.312 technical safeguards) · **GDPR** ★★☆☆☆ (Art. 32 only — heavily caveated).

## Model

**One shared control catalog** (`packages/ai/src/compliance.ts`), not per-framework silos. Each `Control` = a deterministic check over the graph + a mapping to framework control IDs (`{ pci: ["1.2.1"], nist: ["SC-7"], … }`), so one check satisfies many frameworks. Reuses the existing **findings**: a control fails when its backing finding (`sg-world-open`, `iam-wildcard`, `vulnerabilities`, `exposed-vulnerable`, `rds-single-az`, `repos-no-pipeline`, …) is open.

**Four states (trust is visible, P4):**
- `pass` / `fail` — real evidence (fail carries the finding's cited resources).
- `not-applicable` — the estate has no such resource (0 → N/A).
- `not-assessable` — Atlas doesn't yet crawl the data the control needs. A **designed** state (like health's "unknown"), never a silent pass. The `not-assessable` set doubles as the connector roadmap.

**Assessability today** (`ATLAS_ASSESSABLE` in `compliance.service.ts` — the single honest source):
- ✅ assessable: network (`aws.sg.rules` + ELB scheme), IAM policy wildcards, dependency vulns, reachable (exposed+vulnerable), RDS multi-AZ, CI-gate.
- ❌ not-assessable (crawl gaps → **Security Phase 2b**): encryption at rest, encryption in transit, S3 public-access, audit-log (CloudTrail/flow-log) enablement, IAM credential report / MFA / root.

## Build map (v1)

- **Catalog + evaluation (pure, tested):** `packages/ai/src/compliance.ts` — `FRAMEWORKS`, `CONTROLS` (13, all mapped), `evaluateControls(facts)`, `summarizeByFramework(results)`; 6 unit tests. Exported from `@atlas/ai`.
- **API:** `apps/api/src/compliance/` — `ComplianceService.assess(orgId)` reuses `GraphService.summary()` (findings) + a per-kind inventory query + `ATLAS_ASSESSABLE`; `GET /compliance` (Member+, org-scoped, read-only). Registered in `app.module.ts`.
- **Web:** `/compliance` page + `ComplianceView` — framework tabs, a coverage band (assessed / pass / fail / not-assessable + pass-rate + the scope caveat), and the control list with status pills, the framework's mapped IDs, and a "View evidence" link to `/insights/[id]` for fails. Sidebar nav item (ShieldCheck). Per-page skeleton.

## Phase 2b — closing the crawl gaps (in progress, 2026-07-11)

**Framework (done):** assessability is now **per-org + dynamic** — a `CAPABILITIES` map (in `compliance.service.ts`) declares each capability's required IAM action(s) + `supported` flag; the service reads the org's denied actions from `connections.health.missingPermissions` (kept fresh by the health poll) and marks a control `not-assessable` for a precise reason: **"not crawled yet"** vs **"grant IAM action X"** (with the actions as code chips + the `SecurityAudit` shortcut). Per-resource sub-call denials (e.g. S3) are surfaced by dedicated **`POSTURE_PROBES`** so they're attributed to the correct action, never a false pass.

**Crawls shipped:**
- ✅ **Root MFA / account posture** — new `aws.account` node (`iam:GetAccountSummary`) → `root-no-mfa` finding → `access.mfa-privileged` control.
- ✅ **S3 public-access** — bucket public-access-block + policy + ACL (graceful, `unknown` on denial) → `s3-public` finding → `data.no-public-storage` control (gated on `s3:GetBucketPublicAccessBlock`).
- ✅ **Encryption at rest** — RDS `StorageEncrypted` (+ S3 default encryption) → `unencrypted-datastore` finding → `crypto.at-rest` control (no extra permission — `rds:DescribeDBInstances` already granted).

- ✅ **CloudTrail audit logging** — account discoverer checks for a multi-region trail actively logging (CIS 3.1), modeled as `aws.account.cloudTrailEnabled: true/false/null`; `no-cloudtrail` finding fires ONLY on known-false (never null) so a denied read can't false-fire; `cloudtrail:DescribeTrails` posture probe surfaces the permission → `logging.audit-trail` control.

**Remaining (the tail):**
- ⏳ **Encryption in transit** (ELB listener TLS), **VPC flow-logs**, **per-user MFA / credential report** (beyond root). Lower value; the framework already shows them honestly as "not yet crawled".

## Next (v2+)
- Per-framework export (PDF/CSV evidence pack); control history / drift over time; SOC 2 mapping; scoping (tag which resources are in a compliance boundary, e.g. PCI CDE).

## Cross-refs

Reuses the finding/evidence model (`docs/05`, `graph.service.ts summary()`), the exposure + vuln intelligence (`docs/plans/security-vulnerabilities.md`), and the knowledge/guidance pattern (`packages/ai`). Security posture context in `docs/13`.
