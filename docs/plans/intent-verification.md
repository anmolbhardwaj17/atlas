# Plan — Intent Verification (spec → code: "did we build the right thing?")

> **Status:** 🔵 **IN PROGRESS 2026-07-12.** ✅ **IV-1 Jira connector** (read-only; projects + issues with
> description/subtasks/comments → `jira.*` nodes; connect flow in the hub) · ✅ **IV-2 PR↔issue linking**
> (R18 `IMPLEMENTS`, explicit-key deterministic tier) · ✅ **IV-3a coverage judge ENGINE** (`@atlas/ai`
> `coverage.ts`: AC extractor + diff-hunk segmenter + `judgeCoverage` + `COVERAGE_SYSTEM` + the
> deterministic **suppression gate** making false "you didn't build X" structurally impossible; own
> adversarial eval, 14 tests, escaped-false-positive 0 on the set) · ✅ **IV-3b API wiring**
> (`AiService.coverageForPr` assembles PR → `IMPLEMENTS` → issue attributes → diff; `IntentController`
> `POST /intent/prs/:id/coverage`; live-verified honest states on the real DB, 4 integration tests) ·
> ✅ **IV-3c UI** ("Intent coverage" panel on the PR node in Explore — per-criterion status + hedged
> cited notes + honest empty states; button-triggered; web build green). **IV-3 COMPLETE.**
> ✅ **IV-4 fuzzy (no-key) PR↔issue linking** (`@atlas/ai` `suggestIntentLinks`: deterministic
> shared-words + temporal signals → best-with-clear-margin → `ai_suggested` IMPLEMENTS edges for the
> existing confirm/reject loop; `POST /intent/suggest-links` + "Link PRs to Jira" hub button; 7 engine
> + 3 live-DB tests). **Author↔assignee signal deferred** (PR connector doesn't capture author yet).
> ✅ **IV-4 search-backed (2026-07-22)** — the linker was O(prs × issues): it loaded the 600
> most-recent issues and compared every unlinked PR against all of them, which both scaled poorly and
> **capped recall** (a PR implementing an older ticket beyond the window was never a candidate). Now a
> partial GIN FTS index over issue summary+description (migration `0068_jira_issue_fts`) retrieves the
> **top-K relevant candidates per PR** in a single `unnest … CROSS JOIN LATERAL` query (O(prs × K), 3
> round-trips total regardless of PR count), then the SAME pure scorer applies the precision bar to
> just those K. Recall ceiling gone (any issue is a candidate); the pure scorer's `prSearchTokens` is
> exported so the tsquery terms match what it scores. This is the "OpenSearch BM25 top-K" candidate
> step in Postgres — swap-in-later, same contract as the search provider (docs/11). Real-PG test:
> retrieves the right ticket among noise + holds the ≥2-shared-words bar.
> **EPIC COMPLETE** (IV-1→IV-4). Product owner's idea:
> a PR references a Jira task (or should); the code doesn't *break*, but the **logic is wrong / the
> intent isn't implemented**. Can Atlas link the PR to its issue (even when the key isn't in the PR),
> read the story + subtasks + comments, and judge whether the intent was actually built?
>
> **Why it's on-thesis (P1):** op-intel links **runtime → code** ("what broke?"). This links
> **intent → code** ("did we build the right thing?"). The graph holding runtime ↔ code ↔ *intent* in
> one cited structure is something no point tool (Jira, Bitbucket, Datadog) has. Different axis, shared
> code/PR substrate.
>
> **Why it's separate & later:** it needs a **new Jira connector**, and its output is the **softest
> truth-claim Atlas would ever make** — a judgment, not a graph fact. It needs the most careful honesty
> framing + its own adversarial eval. Do NOT bolt it onto op-intel; it's its own epic.
>
> **The deep code review is SIFT, not us.** The pre-merge (and post-merge) *code review* — reading the
> diff/code and understanding whether the logic is correct — is delivered by **SIFT**, a partner product
> (a friend of the product owner). It's already surfaced on the Atlas platform as **"Coming soon"** and
> integrates with Bitbucket (reviews the PR; can run once a PR is merged, walking the code to understand
> it). We will **use SIFT for the code-review layer, not rebuild it** — his code isn't available yet
> (timeline TBD). So Atlas owns the **intent linkage + coverage** (PR↔Jira, story/comments, "was the
> ticket's intent implemented"); SIFT owns **code-logic review**. See "Division of labour" below.

## The boundary it fills (why runtime observation can't)

Silent failures split three ways (see `operational-intelligence.md` → Code context):
- silent **but logged** → caught by the logs/signature layer ✅
- silent, unlogged, **metric-visible** → anomaly detection, later 🟡
- silent, unlogged, **no signal — just wrong** → **invisible to runtime observation by physics** ❌

That last class — code runs fine, returns the wrong answer, nothing errors — is exactly what intent
verification (or tests, or user reports) is for. This is the honest reason the feature exists.

## Three sub-problems

### 1. Link PR ↔ issue (tiered, cited — P3)
| Evidence | Tier |
|---|---|
| Jira key (`PROJ-123`) in PR title / description / commit message | high (deterministic) |
| Key in branch name only | high/medium |
| No key: temporal proximity (ticket → In Progress, then PR opens) × author↔assignee × semantic similarity (diff ↔ ticket summary) | low → **"likely implements PROJ-123?"**, human confirm |

Emits `IMPLEMENTS(pr → issue)` edges. Low-confidence links reuse the **AI-suggested-edge confirm/reject**
loop (badged, user accepts/rejects in the graph). Missing link is a *missing edge*, never a wrong one.

### 2. Read the intent (new Jira connector, read-only / P2)
Jira Cloud REST (OAuth/API token via the Secrets Broker). Pull: story + description + **acceptance
criteria + subtasks + comments** (intent frequently lives in the clarifying comments and subtasks, not
the summary). "Just another connector" in the SDK — same shape as Bitbucket. Also: GitHub/Bitbucket +
Jira native dev-panel links can seed the deterministic tier.

### 3. Judge **intent coverage** (Atlas) — not code quality (that's SIFT)
This is *"did the PR implement what the ticket asked?"*, **not** *"is the code good?"* (SIFT does the
latter). Model reads the intent bundle + the PR diff (+ surrounding code at the deployed/HEAD SHA, L1 retrieval)
and produces a **coverage assessment**, per acceptance criterion:
- *"AC #2 ('email verified before X') — I don't see a verification check in the diff. Possibly
  unimplemented?"* — a **hedged reviewer question, cited to the AC line + the diff hunk (or its
  absence)**, never "your logic is wrong."
- Bias to **questions over verdicts.** False "you didn't build X" (when built differently) is a
  trust-killer → high precision, honest "can't tell from what's stated" when the AC is vague/missing.

## Division of labour — SIFT reviews the code, Atlas owns the intent

| Concern | Owner | Why |
|---|---|---|
| Read the diff/code, judge **code-logic correctness / quality**, review the PR (pre- and post-merge) | **SIFT** (partner, "Coming soon" on the platform, Bitbucket-integrated) | it's his product; don't rebuild code review |
| Link PR ↔ **Jira intent** (even without the key), read story/subtasks/comments | **Atlas** | needs the graph + connector SDK + tiered linking |
| Judge **intent coverage** ("was the ticket's stated intent actually built?") | **Atlas** | it's an *intent* claim, not a code-quality one; cites AC↔diff |
| Hold it all in one cited graph: intent ↔ code ↔ deploy ↔ runtime | **Atlas** | P1 — the traversal is the product |

**Composition (integration OQ, when SIFT lands):** likely bidirectional — Atlas feeds SIFT the **intent
context** (the linked ticket + acceptance criteria) so its review is intent-aware; SIFT feeds Atlas its
**review findings** as first-class nodes/edges on the PR so they show in the graph + Ask AI. Exact
contract TBD with the SIFT author. Until SIFT is available, Atlas's intent-coverage judgment stands
alone (hedged, cited) and does **not** attempt deep code-quality review.

## Positioning
- **Pre-merge code review** → **SIFT** (his engine). Atlas adds **intent-coverage** gaps on the open PR.
- **Post-merge intent-drift audit** (Atlas): "these merged PRs have unaddressed acceptance criteria."

## Honesty / eval (non-negotiable, P3/P4)
- Every claim cites the specific AC/comment/subtask + the specific diff hunk. No un-sourced judgment.
- Own adversarial eval set: planted intent-gaps (must catch) **and** correctly-implemented PRs
  (must NOT flag) — the "escaped false-positive-zero" bar, analogous to G3's hallucination-zero.
- "I can only assess what's stated; the AC is thin here" is a first-class answer.

## Dependencies / sequencing
Needs: **Jira connector** (new source) → PR↔issue linking (inference rules) → coverage judge (extends
the KE-P1 agentic loop + citation binding). Independent of op-intel but reuses its L1 code-retrieval and
the connector SDK. **Pick up after the op-intel Bitbucket-bridge + CloudWatch work lands.**

## Cross-refs
Connector SDK `docs/06`/`07` · tiered edges + confirm/reject `docs/05` + [[ai-assisted-edge-suggestions]]
· agentic loop/citations `docs/plans/ai-knowledge-engine*.md` · code retrieval `operational-intelligence.md`.
