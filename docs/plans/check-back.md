# 📌 Check-back queue — review in a few days

> One place for everything parked: things waiting on **you**, things **deferred by design**, and
> feature **follow-ups**. Skim this after a few days to decide what to pull back in. (The full history
> is on `PROJECT-BOARD.md`; this is just the "not now" shortlist.)

## ⏳ Waiting on you (unblocks real capability)
- **Grant AWS logs/cloudwatch IAM** (`logs:StartQuery`/`GetQueryResults`/`FilterLogEvents`,
  `cloudwatch:GetMetricData`) → unlocks the last big op-intel net-new: **log-based onset** (precise
  incident timing + *new-error-signature* detection = the "is this new or chronic?" distinguisher) +
  **`alarm_transition` events** + the **Phase-2b tail** (encryption-in-transit, VPC flow-logs, per-user
  MFA — already built, currently showing "grant X"). Also add `lambda:GetFunction` (R17 container-image
  attribution) — surfaces on the Integrations hub until granted.
- **Turn on health polling** (`HEALTH_INTERVAL_MINUTES > 0`) → proactive incidents actually fire on the
  live estate. (Works today on current AWS health reads — no grant needed for this part.)
- **Switch the org LLM off `gpt-4o-mini`** → Ask/diagnose get much smarter (the cage is already removed;
  the small model is the remaining limiter). AI polish (adaptive thinking) also benefits here.

## 🟠 Deferred by design (not clean / not worth it as-is)
- **EC2/EKS deploy events** — EKS needs cluster RBAC (not just AWS IAM); EC2 has no real deploy timestamp
  and its changes are already captured as CloudTrail `config_change` events → a separate event would be
  redundant. Only revisit if a customer specifically needs it.
- **Full cascade grouping** — grouping many related failures into ONE incident with root + affected. The
  cheaper **symptom-suppression** (skip a symptom when its dependency already has an open incident) covers
  the main case; full grouping is a moderate build for later.

## 🧵 Feature follow-ups (small, do when the area is touched again)
- **Per-user incident-email opt-out** — incident emails currently go to all active members; add a pref.
- **Immediate security-finding emails** (#44 remainder) — new-critical-finding / compliance-drift emails
  through a per-user notification-preferences surface (the alert policy is the first slice of that model).
- **War Room replay-on-open** — animate a *reopened* incident's saved trace (nice-to-have; live re-run
  exists via "Re-run").
- **get_pr_diff for GitHub** — Bitbucket-only today (fine while you're on Bitbucket).

## 🏗️ Longer-term (infra / pre-GA)
- **Perf P0 — DB co-location** (deploy the API in Sydney, ap-southeast-2, next to Supabase). NO data loss
  (compute moves, not the DB). The dominant prod latency lever; needs a deploy.
- **P2 hardening** — load/perf tests, DR drill, mutation tests, the adversarial QA agent + E2E/contract/
  AI-eval CI stages, RBAC enforcement sweep (#43). Do before onboarding a real design partner.

## 🚧 In flight now (so you know what's NOT parked)
- **Intent Verification** (Jira ↔ PR "did we build the right thing") — building.
- **AI polish** (adaptive thinking) — building.
