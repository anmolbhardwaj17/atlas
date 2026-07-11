# Plan — Incident War Room (the presentation layer for Phase D)

> **Status:** 📋 **Captured 2026-07-11 — NOT started.** Product owner's idea: when something is broken,
> a **"Take to War Room"** button opens a dedicated page that shows the exact node + its blast radius on a
> **live map**, streams the diagnosis **step-by-step** (in parallel where the trace fans out — e.g. infra
> trace ∥ Bitbucket PR trace), then shows the **issue + how to fix it** below. If the user doesn't want to
> fix it now, the whole investigation is **saved (in Insights)** so they can revisit it later.
>
> **Verdict (honest):** strong idea, on-thesis, and **buildable now** — it's mostly a *view* over the
> already-built diagnose loop + map + blast-radius traversal, not a new engine. It doesn't wait on the AWS
> logs grant (the diagnose engine works permission-free today; the war room sharpens when onset/logs land).

## Why it fits Atlas
- **Trust is visible (P4).** Streaming the *reasoning* — "health of X → unhealthy since 14:05", "3 changes
  in the 6h window", "traced DEPLOYS_TO → repo Y", "fetched PR #482 diff" — each with a citation, is the
  honest opposite of a black-box verdict. Showing the work IS the product.
- **Graph is the product (P1).** The live map + blast radius lighting up during the trace is the thing no
  logs tool (Datadog/Sentry) can do — they don't hold the topology.
- **Reuse, not rebuild.** The agentic loop already runs tools (`diagnose`, `get_pr_diff`, blast-radius) and
  streams over SSE; the map component + `blastRadius`/`dependencies` traversal exist. The war room is a rich
  visual surface over that existing tool-call trace + a persistence step.

## Guardrails (non-negotiable — the failure modes)
1. **Real steps, not theater.** Every streamed step is an *actual tool call with real evidence + a
   citation* — never a decorative "Analyzing…" spinner. Honest → magic; loading-show → erodes trust.
2. **Truthful parallelism.** Show parallel lanes only when the loop *actually* fans out. True concurrency is
   a small loop enhancement; don't fake it.
3. **Ranked verdict, never false certainty.** "The issue + fix" stays *ranked hypotheses* with "no clear
   culprit" as a first-class outcome (the adversarial quiet-window bar from Phase D). The fix is **advisory**
   (labeled advice, cited facts). Real code fixes are **SIFT**'s job (see [[project-intent-verification]]).

## Shape
**Page `/war-room/[id]`:**
- **Header** — node, health state, "broken since", severity, trigger.
- **Center: live map** — the node + blast radius; nodes light as they're examined; the DEPLOYS_TO→repo
  edge and any red dependency get traced. Reuses the existing map component + blast-radius traversal.
- **Side/below: investigation log** — the real streaming steps (parallel lanes when the loop fans out),
  each with status (running/done) + a citation to the node/edge/event/PR it used.
- **Bottom: verdict** — ranked, cited hypotheses (`code / config / dependency-correlated | chronic |
  unknown`), a likely cause when confident, advisory fix guidance + suggested next steps.
- **Actions** — Resolve · Dismiss (won't fix) · **Save & analyze later**.

**Persistence — `incidents` (net-new, org-scoped RLS):** `node_id(s)`, `opened_at`, `trigger`
(map-red / finding / alert), `status` (open|analyzing|resolved|dismissed), `evidence` + `verdict` (jsonb),
`resolution`, `resolved_at`. Surfaced in **Insights** as "Past incidents" → reopening **replays the saved
investigation**, and repeat incidents build a history ("this broke before"). An incident is essentially a
richer, durable sibling of the existing finding lifecycle.

**Entry points ("Take to War Room"):** a red/unhealthy map node · an Insights finding · an alert/notification.
One consistent action, three surfaces.

## Build order (when picked up)
1. **Persist**: `incidents` table + create/read/update endpoints (org-scoped).
2. **War Room page**: run the existing diagnose loop, stream its tool-call trace into the log + drive the
   map highlight; render the ranked verdict.
3. **Insights integration**: "Past incidents" list + reopen (replay the saved trace).
4. **Entry buttons** on map/insights/alerts.
5. (later) **Parallel fan-out** in the loop for true concurrent lanes; onset/log steps once the grant lands.

## Dependencies / cross-refs
Phase D engine (`diagnose`/`get_pr_diff`, built) + the map + blast-radius traversal — all exist. Verdict
honesty per `operational-intelligence.md` Phase D. Fix-guidance is advisory (KE-P2); deep code fixes are
**SIFT** ([[project-intent-verification]]). Incident persistence follows `docs/04` conventions (org-scoped
RLS, composite FKs), sibling to the finding lifecycle.
