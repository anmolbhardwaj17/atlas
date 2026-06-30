---
name: board
description: View or update the Atlas project board (docs/PROJECT-BOARD.md). Use to change a task's status, add a status note, mark work done, add new tasks/sub-tasks, or append to the activity log. Use whenever Atlas work starts, progresses, or finishes — keeping the board current is how future sessions stay oriented.
---

# Atlas Board

The board (`docs/PROJECT-BOARD.md`) is the durable, cross-session source of truth for project status. Keep it accurate — a stale board blinds the next session.

## To VIEW
Read `docs/PROJECT-BOARD.md` and report the current milestone, in-progress/blocked tasks, and progress summary.

## To UPDATE (the common case)
1. **Read** `docs/PROJECT-BOARD.md`.
2. **Change the task's Status** using the legend: 📋 Todo · 🔵 In Progress · 🔍 Review · ✅ Done · ⛔ Blocked · ⏸️ Deferred.
3. **Update the task's Status note** with the latest concrete state (what's done, what's left, any blocker + why).
4. If a task is now ✅, note **which `docs/15` Definition-of-Done gates** it passed (tests, US-id, NFR).
5. **Update the `📍 YOU ARE HERE` block** if the current milestone or "suggested next action" changed.
6. **Update the progress summary** counts if a sprint/doc changed state.
7. **Append a dated row to the Activity Log** (newest at top): `| YYYY-MM-DD | who | what happened |`. One concise line per work session or notable event.
8. **Update the `Last updated:` date** at the top.

## Adding tasks/sub-tasks
- Under the relevant Epic, add a row with an ID (reuse the sprint code, e.g. `F1`, or add `F1.1` for a sub-task), title, 📋 status, linked `docs/NN`, and a note.
- Keep tasks small enough to reason about and trace to a doc.

## Rules
- **Be honest about status.** If tests failed or a step was skipped, say so in the note — don't mark ✅ prematurely.
- Keep notes terse and concrete (state, not prose).
- Don't delete history; the Activity Log is append-only.
- After updating, briefly tell the user what changed on the board.
