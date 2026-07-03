# Plan — Security & Vulnerability Intelligence

> **Status:** 📋 Planned (not started). Captured 2026-07-04.
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

1. **Dependency graph** — add **manifest parsing** to connectors (fetch `package.json` / `requirements.txt` / `go.mod` / `pom.xml` per repo → `package` nodes + `DEPENDS_ON` edges). *Buildable now against real Bitbucket repos* — this is the missing input (the Bitbucket connector currently crawls repos/PRs/pipelines/users, not file contents).
2. **OSV enrichment** — package nodes → OSV → `vulnerability` nodes + `AFFECTS` edges (real CVEs, free).
3. **Findings + prioritization** — a "Security" surface: findings ranked by severity; the **exposed-AND-vulnerable** toxic combination (needs AWS); cloud-posture inference rules (public SG / S3 / wildcard IAM) over the AWS graph.
4. **Ask AI + dashboard** — "What are my most critical vulnerabilities?", "Which internet-exposed services have known CVEs?" — cited answers.

## Sequencing vs. current data

- **Steps 1–2 work today** (Bitbucket connected) → real dependency vulnerabilities for the repos, no extra account.
- **The "exposed AND vulnerable" magic** (Step 3 toxic combo) needs **AWS** → lights up when the read-only AWS role lands. Until then, vuln + severity findings stand alone; cloud-posture rules are ready to fire on AWS connect.

## Fit note

Strong fit for **Siemba** (a security company — repos are nuclei/ZAP/pentest/CTEM tooling). "Reachable, exploitable" prioritization is their domain.

## Cross-refs

Relates to the roadmap backlog (v1.3 enterprise security) and the connector SDK (`docs/06`/`07`/`07b`). New node kind + inference rules follow `docs/05` (inference) and `docs/03`/`04` (domain/schema). Findings surface per `docs/09` §5.2 (Needs attention) + Ask AI (`docs/10`).
