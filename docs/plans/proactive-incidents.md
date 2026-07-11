# Plan — Proactive Incidents (with alert-fatigue guardrails)

> **Status:** ✅ **BUILT 2026-07-11.** Turns the War Room from *pull* (you notice, you open it) into
> *push* (Atlas tells you) — WITHOUT flooding people. Alert fatigue is the #1 reason ops tools get muted,
> so the **guardrails ship before the trigger.**

## The governing principle: backlog ≠ new incident

- **Backlog** (everything already wrong when you connect) → stays a **pull list** (Insights + weekly
  digest), worked one-by-one at your own pace. **Never paged, never auto-War-Roomed.** (No change; just
  make sure health *regressions* are the only proactive trigger, never findings.)
- **New acute regression** (a *healthy* prod resource *transitions* to broken *after* baseline) → rare and
  genuinely urgent → this is the ONLY thing that proactively opens an incident + alerts.

## Guardrails (build first)

- **G1 — Alert policy per org:** `off` (monitoring only, map turns red but no pages) · `prod` (prod
  regressions only) · `all`. **Default `prod`.** Gates every proactive alert. A Settings toggle.
- **G2 — Regression-only = baseline for free:** auto-incidents fire ONLY on `healthy → unhealthy|degraded`.
  A first-sighting (`unknown → broken`) or a pre-existing broken state on first sync **never** fires — so
  day-one onboarding is silent by construction. (health_transition already carries `prev`.)
- **G3 — Dedup + grouping:** one open incident per node (existing `uq_incident_open_per_node`); and
  suppress a *symptom* — if an upstream dependency already has an open incident, don't open a second for
  the thing it cascaded into (blast radius is the grouping key).

## Proactive trigger (on top of the rails)

- **P1 — Deterministic headline (NO LLM, cheap, instant):** for the node that just regressed, rank its
  `node_events` in the window × graph-distance + blast radius → a classification (deploy / config /
  dependency / capacity / unknown) + one-line cause. Grounded, no hallucination risk, cheap enough to run
  on every qualifying transition. This is what the alert/email says.
- **P2 — Auto-create incident** on a qualifying regression (policy ✓ + prod/high ✓ + regression ✓ + not a
  dedup/symptom) with `trigger='alert'` and the deterministic verdict stored.
- **P3 — Notify:** bell notification (+ email when policy = `all`, later) → "`X` went unhealthy — likely
  cause: `Y`. Open War Room →".
- **P4 — War Room:** shows the deterministic headline immediately; the **full live AI diagnosis still runs
  on open** (the animation is preserved — nothing is pre-computed for the page). The expensive agentic
  trace only runs when a human actually looks; the background did only the cheap deterministic pass.

## Why this doesn't overwhelm (how mature tools do it)
Baseline-on-connect (adopt existing state) · alert on transitions not states · severity+prod gating
(page ≠ ticket ≠ dashboard) · group related failures into one incident · dedup/flap suppression ·
conservative default + user opt-up. All reflected in G1–G3 + P2.

## Build order
1. G1 alert policy (DB + service + Settings toggle).
2. P1 deterministic headline (pure, tested).
3. G2/G3 + P2 auto-incident on qualifying regression (server-side, at the health/notification hook).
4. P3 bell notification.
5. P4 War Room shows the preliminary headline; live diagnosis unchanged.
(Email at `all` and full cascade-grouping are follow-ups.)

## Cross-refs
Sits on [[project-north-star-operational-intelligence]] Phase D + `war-room.md`. Backlog stays in Insights
(`compliance.md`/findings) + the weekly digest (`email.md`). Deterministic headline reuses `node_events`
(Phase C) + blast-radius traversal.
