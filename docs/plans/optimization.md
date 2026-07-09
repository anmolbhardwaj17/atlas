# Plan — Advisor (architecture redesign you can see and argue with)

> **Status:** 🔵 In progress — architecture-proposal first slice building now.
> **The vision (product owner):** Atlas proposes **structural changes to the infra** — "move this off **EC2 → ECS**", "put a **load balancer** in front", "make this **Multi-AZ**", "use a **managed DB**" — and shows them as a **proposed architecture graph next to the current one** (before / after), which you can **discuss / argue** with Atlas.
> **NOT** a findings list (that's Insights). This is architecture redesign, visualized.
> **Cross-refs:** `docs/05` (graph), `docs/09` (map/React-Flow render), `docs/10` (AI, fact/advice trust model), `docs/plans/operational-intelligence.md`, `docs/plans/atlas-suite-vision.md`.

---

## 1. Why this fits Atlas (and why it's not generic advice)

Everyone — and ChatGPT — will tell you "use Multi-AZ" or "containerize." The only reason to pay Atlas is that it proposes changes **to your actual topology, grounded in the real graph**, and shows the **before/after** so you can see exactly what moves. Not "add a load balancer" but: *"`calsaws-report-server` is a single EC2 serving traffic with no LB — here's the same thing behind an ALB + auto-scaling."* rendered as a graph. P1 (graph is the product, AI is the interface); the **argue loop** is the differentiator.

## 2. The hard rule — the proposed graph is a *recommendation*, not truth (the moat)

A proposed architecture is **generative** — Atlas inventing a design — which is the opposite of "observed truth." So the trust rules:

- **Current graph = observed** (what Atlas always is).
- **Proposed graph = clearly-labeled recommendation** — visually distinct (ghosted/dashed "proposed" nodes), never mistakable for reality.
- Proposals are **pattern-anchored to real facts** (this EC2 has no LB; this DB is single-AZ), **not** free-form LLM hallucination. The LLM *explains* and *debates*; the *structure* of a proposal comes from a deterministic pattern over the graph.
- Tradeoffs stated honestly; **no fabricated $** until Cost Explorer is connected (directional only — "more instances → more cost").

## 3. The proposal engine

A **pattern library** — each pattern is a pure function over the graph that detects an anti-pattern and emits a **Proposal**:

```
Proposal = {
  id, title, category (reliability|scalability|security|cost), impact,
  rationale,   // grounded facts about the current setup
  tradeoff,    // honest cost/effort vs benefit
  current:  { nodes[], edges[] },   // the affected subgraph, as-is (observed)
  proposed: { nodes[], edges[] },   // the redesigned subgraph (added/changed nodes flagged)
  evidence,    // node ids, for citations + the discuss loop
}
```

The frontend renders `current` vs `proposed` side-by-side, delta highlighted; "Discuss" opens Ask Atlas seeded with the proposal.

## 4. Pattern library (grounded, from the graph)

**Seed (first slice):**
- **Single-AZ datastore → Multi-AZ** — RDS/ElastiCache with `multiAz:false` / single node → add a standby. *(deterministic; real material: the 2 calsaws single-AZ DBs.)*
- **Standalone EC2 → ECS/Fargate behind an ALB + auto-scaling** — an EC2 not fronted by a load balancer → containerize + load-balance + scale. *(the product owner's headline example; framed as a proposal to argue.)*

**Roadmap:** self-managed-on-EC2 → managed (RDS/ElastiCache); N identical EC2s → one auto-scaling group; public service, no WAF → +WAF; over-provisioned instance → right-size (Tier 2); chatty cross-AZ → co-locate.

## 5. Before / after visualization

Each proposal renders its small affected subgraph twice — **current** and **proposed** — using node chips (kind icon + label) connected by arrows. **Added** nodes are ghosted/green ("proposed"); removed = struck/red; changed = amber. Small subgraphs (2–6 nodes), so a lightweight diagram beats pulling in the full Map canvas.

## 6. The discuss / debate loop

"Discuss with Atlas" opens Ask Atlas seeded with the proposal — grounded in the current facts + the pattern's rationale, honest tradeoffs, fact/advice model (`docs/10`). *"Why ECS?" · "What does the LB cost me?" · "This is a VPN box, it doesn't need an LB" → Atlas concedes/adjusts.* The discussion is also the **precision mechanism**: a proposal is a starting point to argue, not an asserted fact.

## 7. Tier 2 — the cost / memory numbers (needs Cost Explorer + CloudWatch)

Attach real deltas to each proposal ("+$40/mo for the standby, −$0 downtime risk"; "this instance is 8% utilized → right-size, −$X"). Needs Cost Explorer/CUR + CloudWatch utilization. Until then, proposals carry directional tradeoffs + a "connect Cost Explorer to quantify" teaser — **never fabricated figures**.

## 8. First slice (this change)

The **`/advisor` page** as an architecture advisor: a `GET /advisor/proposals` endpoint (pattern engine over the graph, seed patterns = Multi-AZ + EC2→ECS/ALB) → the page lists proposals, each showing **current vs proposed** as a before/after diagram + rationale + tradeoff + a **"Discuss with Atlas"** button. Replaces the findings-based Advisor (findings live in Insights). Honesty teaser for the Tier-2 cost numbers.

## 9. Definition of Done (per slice)
Proposals are pattern-anchored to real graph facts (no free-form hallucination); the proposed graph is clearly labeled a recommendation; no fabricated numbers; `pnpm run check` green; board entry.
