---
name: resume
description: Resume work on the Atlas project. Loads full project state (task board, doc map, key decisions, working style) and reports where we are, what's done, and proposes the next step. Use at the start of any Atlas session or when the user says "resume", "where were we", "continue", or "what's next".
---

# Resume Atlas

Goal: get fully oriented on the Atlas project so you can continue work as if you never left — even on a cold session.

## Steps

1. **Read `CLAUDE.md`** (project root) — the operating manual: rules, stack, the user's working style, and the key interactive decisions. Internalize the Cardinal Rules.
2. **Read `docs/PROJECT-BOARD.md`** — the task board. Identify:
   - the **📍 YOU ARE HERE** section (current milestone + suggested next action),
   - the **progress summary** (docs done, build sprints started),
   - the most recent **Activity Log** entries (what happened last session),
   - any 🔵 In-Progress or ⛔ Blocked tasks.
3. **Skim `docs/README.md`** only if you need the doc index / cross-reference map for the task at hand.
4. **Note the memory** surfaced in `<system-reminder>` blocks (decisions, preferences) — don't re-derive what's already recorded.
5. **Report back to the user concisely:**
   - one-line project state ("Blueprint complete; build not started" or the current sprint),
   - what was done most recently (from the activity log),
   - the **single most logical next task** (from the board), with the doc(s) it needs,
   - then **ask for confirmation** before starting substantial work (the user reviews each unit).

## Rules
- Do **not** start building/editing until you've reported state and the user confirms the next step (unless they explicitly said "just continue").
- If the board and docs disagree with reality, the **docs are authoritative** — flag the drift.
- Keep the summary tight; the user wants orientation, not a wall of text.
