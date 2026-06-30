---
name: atlas-doc
description: Create or revise an Atlas /docs design document in the established house style. Use when adding a new doc, updating an existing one, or when a code change alters a contract and the doc must change first. Enforces the standard section structure, ID conventions, cross-referencing, and rationale-for-every-decision rule.
---

# Atlas Doc Authoring

Atlas design docs (`docs/00`–`18`) are **authoritative** — code conforms to them, and if a contract changes the **doc changes first** (`docs/14` §19, `docs/16` CS-8). Keep every doc consistent with this house style.

## Required structure (every doc)
A header block (status, version, date, owner, audience, **Depends on**, **Consumed by**), then:

1. **Purpose** — what this doc decides and why it exists.
2. **Scope** — In scope; Out of scope (with pointers to the doc that owns each out-of-scope item).
3. **Assumptions** — `A##`, inheriting upstream assumptions.
4. **Body** — the actual design, with **Mermaid diagrams** where they clarify (architecture, flows, state machines, ER). Include **examples** for APIs and **sequence diagrams** for workflows.
5. **Design Decisions** — `DD-x`, each stating **why** it was chosen and the **alternatives rejected**. *Never an unexplained decision.*
6. **Risks** — `*-R#` with mitigations.
7. **Edge Cases** — `EC-x`.
8. **Open Questions** — `OQ-x` (deferred decisions; don't silently guess).
9. **References** — Upstream (what it depends on) + Downstream (what consumes it), by doc number.
10. **Change log** — version table.

## ID conventions (reuse, don't reinvent)
`P1–P10` principles · `G/NG` goals · `A##` assumptions · `R##` risks · `FR/NFR` requirements · `US-x` stories · `BR-x` business rules/invariants · `DD-x` decisions · `OQ-x` open questions · `EC/SEC` edge cases/security. Cross-reference other docs by number (e.g. "`05` §7.2") so decisions trace end-to-end.

## Rules (the house standard)
- **Explain every WHY.** Each decision cites the principle/goal/requirement it serves and the alternative it beat.
- **Stay internally consistent** — reference related docs; never contradict an upstream contract. If you must, change the upstream doc too.
- **Be specific, avoid generic filler.** Production-grade detail, the quality bar of Linear/Datadog/GitHub eng docs.
- **One doc/feature at a time; confirm with the user** before moving on (the user reviews each unit).
- After writing/editing a doc, **update `docs/README.md`** (if a new doc) and **`docs/PROJECT-BOARD.md`** (status + activity log) via the `/board` skill.
