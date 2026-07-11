# Plan — Security & Vulnerability Intelligence

> **Status:** 🟢 **Phase 1 BUILT (2026-07-05)** + 🟢 **Phase 2 BUILT (2026-07-11)**. Phase 1: dependency intelligence live end-to-end against the real Siemba Bitbucket graph (manifest parsing → `external.package` + `DEPENDS_ON_PKG` → OSV.dev → `security.vulnerability` + `AFFECTS` → severity/blast-radius/sprawl findings + Ask AI). **Phase 2 — the "exposed AND vulnerable" toxic combination — is now built:** exposure is derived as a first-class graph fact (`EXPOSED_VIA`, rule R16) from world-open SGs + internet-facing LBs, ALB→ECS routing is recovered by shared target-group (rule R15), and the dashboard's headline **"internet-exposed vulnerability"** finding + Ask AI walk the full chain (CVE → package → repo → service → exposed). **Phase 2b (still open):** EC2 public-IP, public-subnet, and **S3 public-access** exposure — all need connector changes (uncrawled today). Captured 2026-07-04, Phase 2 built 2026-07-11.
>
> **Phase 2 build map:** ELB `aws.elb.targetgroups` signal `packages/connector-aws/src/services/routing.ts` · R15 `alb_routes_to_service` `packages/inference/src/rules/r15-alb-service.ts` · R16 `internet_exposure` `packages/inference/src/rules/r16-exposure.ts` (→ `EXPOSED_VIA`) · migration `0044_exposure_seed` · finding `exposed-vulnerable` in `graph.service.ts summary()` · guidance `reachable vulnerability` in `packages/ai/src/knowledge.ts`. **Requires an AWS re-sync** to populate the new ELB signal so the ECS path (Siemba's case) lights up; R16's SG/LB→EC2 paths fire on existing data.
>
> **Phase 1 build map:** OSV client `packages/ingest/src/osv.ts` · enrichment stage `packages/ingest/src/osv-enrichment.ts` (post-crawl, best-effort, wired in `sync-worker.ts`) · Bitbucket manifest parsing `packages/connector-bitbucket/src/parsers/manifest.ts` (npm/pypi/go/maven incl. `pom.xml`) + `client.content()` + `crawl.ts` fetch + `DEPENDS_ON_PKG` edges · node kind migration `0022_vulnerability` · findings (Vulnerabilities / Blast radius / Dependency sprawl) in `graph.service.ts summary()` · guidance in `packages/ai/src/knowledge.ts`.
> **Why Atlas is uniquely good at this:** it already holds **code + cloud + exposure** in one graph, so it can answer the *reachability/prioritization* question no single-purpose scanner can — the "toxic combination," not a wall of 500 CVEs.

---

## The core idea

Every SCA/CSPM tool emits a huge list of vulnerabilities; the hard part is knowing which matter. The valuable question is the **intersection**:

> *"Which services are **internet-exposed** AND running a **known-vulnerable dependency** AND have **broad IAM**?"*

That's a graph traversal. Atlas connects the domains other tools can't see across.

## Graph model

**New node kind:** `vulnerability` — CVE/GHSA id, CVSS severity, summary, affected version range, fix version.

**New / reused edges:**
```
vulnerability --AFFECTS--> package          (dependency, from manifests)
repo/service  --DEPENDS_ON--> package       (Atlas already models packages)
service       --DEPLOYED_TO--> cloud resource (from the AWS crawl)
cloud resource--EXPOSED_VIA--> LB / public subnet + open security group
```
Full chain: **CVE → package → repo → service → cloud resource → internet.**

**Inference (precision-first, P3):**
- Derive `exposed` for a resource from the cloud graph (public subnet + SG open to `0.0.0.0/0` + LB/public IP).
- Derive `critical` = a `vulnerability` whose package is used by an `exposed` service. That inferred edge is the whole product.
- Every finding is cited to the CVE + the exact dependency/exposure path (P4).

## Vulnerability data sources (cheapest → richest)

1. **OSV.dev** — free, no account. Parse dependency manifests → package nodes → query OSV for each `package@version` → CVEs. **Real vuln intelligence with zero paid scanner.** Build this first.
2. **Dependabot / Bitbucket security alerts** — host-computed.
3. **Snyk** — SCA + container + IaC.
4. **SBOM ingestion** (CycloneDX/SPDX).

Plus **cloud posture (CSPM) from the existing AWS crawl** — no extra tool: public S3, security groups open to the world, IAM roles with `*`/admin.

## Build steps (all-real, no-extra-account path first)

1. ✅ **Dependency graph** — manifest parsing in the Bitbucket connector (fetches `package.json` / `requirements.txt` / `go.mod` / `pom.xml` per repo via `client.content()` → `external.package` nodes + `DEPENDS_ON_PKG` edges, versions on the edge). Cross-provider URN (`external:<ecosystem>:package:<name>`) shared with GitHub.
2. ✅ **OSV enrichment** — a post-crawl stage (`runOsvEnrichment`, not a connector/rule — it does network I/O) queries OSV.dev per `package@version` → `security.vulnerability` nodes + observed `AFFECTS` edges (each with a provenance row `osv:<id>`). Best-effort: an OSV outage never fails the sync.
3. ✅ **Findings** — dashboard/Insights findings: **Vulnerabilities** (severity-ranked), **Blast radius** (a vulnerable package many repos share — one upgrade fixes N), **Dependency sprawl** (one package pinned to many versions), and now (Phase 2) the **exposed-AND-vulnerable** toxic combination: R16 derives `EXPOSED_VIA` (world-open SG / internet-facing LB), R15 recovers ALB→ECS routing, and the `exposed-vulnerable` finding walks the full chain. Cloud-posture rules (world-open SG, internet-facing LB, wildcard IAM) already fire; **S3 public-access is Phase 2b (uncrawled)**.
4. ✅ **Ask AI + dashboard** — findings flow into Insights + Ask AI automatically (they're `Finding`s); the advisory path explains each via the knowledge pack (`vulnerabilities`, `dependency sprawl`, `blast radius`). "Exposed AND vulnerable" answers arrive with AWS.

## Sequencing vs. current data

- **Steps 1–2 work today** (Bitbucket connected) → real dependency vulnerabilities for the repos, no extra account.
- **The "exposed AND vulnerable" magic** (Step 3 toxic combo) needs **AWS** → lights up when the read-only AWS role lands. Until then, vuln + severity findings stand alone; cloud-posture rules are ready to fire on AWS connect.

## Fit note

Strong fit for **Siemba** (a security company — repos are nuclei/ZAP/pentest/CTEM tooling). "Reachable, exploitable" prioritization is their domain.

## Cross-refs

Relates to the roadmap backlog (v1.3 enterprise security) and the connector SDK (`docs/06`/`07`/`07b`). New node kind + inference rules follow `docs/05` (inference) and `docs/03`/`04` (domain/schema). Findings surface per `docs/09` §5.2 (Needs attention) + Ask AI (`docs/10`).
