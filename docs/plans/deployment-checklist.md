# Atlas — Deployment Checklist (2026-07-21)

A practical, ordered runbook for a first production deploy. Ties together the production-hardening
audit (Phases A–E), the compliance close-out, and the container/worker artifacts. The design is in
`docs/17-deployment.md`; this is the do-it list.

> **Deploying on Fly.io? → `fly-deploy-runbook.md` is the one to follow** (docs/17 **DD-2a**: Fly for
> MVP, ECS at scale — chosen for the Sydney region that co-locates with Supabase, ~$9/mo, and zero new
> build surface). It has the exact commands. This file remains the platform-neutral checklist and the
> reference for an ECS deploy later; sections 0–2 and 5–7 apply to both.

## 0. Prerequisites (infra)
- [ ] **Postgres** — Supabase (session pooler) or RDS/Aurora Multi-AZ + PITR. Two roles: the owner
      (migrations) and the restricted **`atlas_app`** (NOBYPASSRLS, non-superuser) the app connects as.
      The app **refuses to boot** as a superuser/BYPASSRLS role (R8 fail-closed).
- [ ] **Redis** — ElastiCache (HA). Required: without `REDIS_URL` the queue is in-memory and jobs are
      lost on restart. `noeviction` so a backlog surfaces via `atlas_sync_queue_depth`, never drops.
- [ ] **Object storage** — Supabase Storage / S3 for raw snapshots (`SUPABASE_*`).
- [ ] **Secrets store** — Secrets Manager / platform secrets for `SECRET_ENCRYPTION_KEY`, DB creds, etc.
- [ ] *(optional)* **OTLP collector** (ADOT/Tempo/Jaeger/Honeycomb) for traces; a Prometheus scraper.

## 1. Config
- [ ] Fill `.env.production` from `.env.production.example`. In prod the config **fails fast at boot**
      if any of `DATABASE_URL, SECRET_ENCRYPTION_KEY, REDIS_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
      ANTHROPIC_API_KEY` is missing (no silent degradation, audit A3).
- [ ] **`ANTHROPIC_API_KEY` is required** — it is the platform narrator for every org that hasn't
      added a BYO-LLM key. Before the deploy-readiness audit its absence silently fell back to the dev
      `MockLLMProvider`, which served `"(Atlas dev) …"` placeholder prose as though it were a real
      answer. Set `ALLOW_BYO_ONLY_LLM=true` only if every org supplies its own key (orgs without one
      then get a clear error, never mock text).
- [ ] Generate the encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- [ ] Set `WEB_ORIGIN` (CORS) + `PUBLIC_API_URL` to the real domains.

## 2. Database
- [ ] Run migrations as the **owner**: `DATABASE_URL_MIGRATE=… pnpm --filter @atlas/db run migrate`
      (forward-only, transactional, idempotent — currently through `0067`).
- [ ] Provision the `atlas_app` login/password out of band (or `ATLAS_APP_PASSWORD=… pnpm --filter
      @atlas/db run setup:app-role` in ephemeral envs).

## 3. Build + push the images — **automated**
- [ ] Nothing to do by hand: **`.github/workflows/release.yml` builds and pushes both images to GHCR
      on every green push to `main`**, tagged by full commit SHA (immutable), with provenance + SBOM,
      and Trivy-scanned into the Security tab. `.github/workflows/ci.yml` also `docker build`s both
      on every push, so a broken Dockerfile fails in CI rather than during a deploy.
- [ ] **Set the repository variables** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `NEXT_PUBLIC_API_URL` before deploying the web image anywhere real — they are **inlined into
      the client bundle at build time**, so changing them needs a rebuild, not a redeploy. Until
      they're set the web image builds against placeholders (fine for smoke-testing only). Never
      set the service-role key as a build arg.
- [ ] Manual equivalents, if you need one: `docker build -t atlas-api-v1 .` and
      `docker build -f apps/web/Dockerfile -t atlas-web .` (both from the repo root).

## 4. Deploy — two ECS services from the ONE api image (+ the web image)
- [ ] **api** — `CMD node dist/main.js`. Autoscale on CPU/request count. Health checks:
      `GET /health` (liveness, cheap) + `GET /health/ready` (DB probe — drains a dead-pool pod, A2).
      Fastify `requestTimeout` 30s; graceful shutdown drains in-flight work.
- [ ] **worker** — override `CMD node dist/worker.js` (headless: BullMQ consumer + schedulers, no HTTP).
      **Autoscale on `atlas_sync_queue_depth`** (docs/17 §4). `SIGTERM` drains the active job (no lost
      sync). Enable the cadences (`SYNC/HEALTH/NOTIFY_INTERVAL_MINUTES`) here.
- [ ] **web** — `node apps/web/server.js` on `:4291` behind the TLS edge.
- [ ] *(single-node MVP alternative)* Run only the API — it runs the worker + schedulers in-process.

> **Scheduler concurrency (resolved).** The cadence ticks used to be bare `setInterval` with no
> cross-instance coordination, so every replica with `SYNC/HEALTH/NOTIFY_INTERVAL_MINUTES` set would
> tick — duplicate Slack alerts, duplicate `autoDiagnose` LLM spend, duplicate cloud crawls. They now
> take a **Postgres advisory lock per tick** (`LeaderLockService`), so it is safe to set the cadences
> on any number of tasks and to autoscale the worker. Retention, the sync reaper and the weekly digest
> were already safe by construction (age-based / single atomic UPDATE / per-org claim) and are
> deliberately not locked.

## 5. Observability
- [ ] Scrape `GET /metrics` (set `METRICS_TOKEN` and pass `Authorization: Bearer …` if internet-facing).
      Exposes `http_requests_total` / `http_request_duration_seconds` (by route), `atlas_sync_jobs_total`,
      `atlas_sync_queue_depth`, + default process metrics.
- [ ] Set `OTEL_EXPORTER_OTLP_ENDPOINT` to turn on request→pg tracing (off/zero-overhead when unset).
- [ ] **Load `deploy/prometheus-alerts.yml`** — the alerts now exist as code (availability, 5xx rate,
      p95 latency, uncaught exceptions / unhandled rejections, queue backlog, sync failure rate,
      stalled scheduler). Every rule references a metric this codebase actually exports.
- [ ] Alert on `atlas_process_errors_total` in particular: unhandled rejections are survived by
      design, so they never show up as restarts — the counter is the only signal.

## 6. Post-deploy verification
- [ ] `GET /health/ready` → `{db:"up"}`; `GET /metrics` returns exposition text.
- [ ] Connect a source → confirm a sync job flows through Redis (queue depth moves, `atlas_sync_jobs_total`
      increments) and the graph populates.
- [ ] RLS-coverage + read-only fitness tests are green in CI (they gate every push).

## 7. Ongoing runbooks
- [ ] **Secret key rotation**: set the new `SECRET_ENCRYPTION_KEY`, move the old one to
      `SECRET_ENCRYPTION_KEYS_RETIRED`, deploy, then `pnpm --filter @atlas/ingest run rotate:secrets`
      until it reports 0 remaining — then drop the retired key.
- [ ] **DB co-location (perf P0)**: run the API/worker in the **same region as the DB** (Supabase is
      ap-southeast-2 / Sydney) — turns ~137ms DB round-trips into ~1–3ms. Compute moves, not the DB
      (no data migration). The single biggest prod latency lever.

## Status of the readiness work behind this checklist
- **Backend audit A–E + medium bucket + deferrals**: complete (`docs/plans/backend-production-audit.md`).
- **Compliance close-out**: key-rotation, prompt-injection/uncited streaming, webhook encryption,
  org-deletion sink — done (legal finalization of privacy policy/DPA/Terms still needs counsel).
- **Durable queue (A1)**: proven against a live Redis (enqueue→process→dedupe→depth→drain).
