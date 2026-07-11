# Plan — Intent Verification (spec → code: "did we build the right thing?")

> **Status:** 📋 **Captured 2026-07-11 — NOT started. Phase-2+ epic, own feature.** Product owner's idea:
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

### 3. Judge coverage (the hard, soft-truth part)
Model reads the intent bundle + the PR diff (+ surrounding code at the deployed/HEAD SHA, L1 retrieval)
and produces a **coverage assessment**, per acceptance criterion:
- *"AC #2 ('email verified before X') — I don't see a verification check in the diff. Possibly
  unimplemented?"* — a **hedged reviewer question, cited to the AC line + the diff hunk (or its
  absence)**, never "your logic is wrong."
- Bias to **questions over verdicts.** False "you didn't build X" (when built differently) is a
  trust-killer → high precision, honest "can't tell from what's stated" when the AC is vague/missing.

## Positioning
- **Pre-merge review assist** (higher value): surface gaps on the *open* PR before the bug ships.
- **Post-merge intent-drift audit**: "these merged PRs have unaddressed acceptance criteria."

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
