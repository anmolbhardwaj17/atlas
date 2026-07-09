# Plan — Optimize (grounded infra recommendations you can argue with)

> **Status:** 🔵 In progress — Tier-1 Advisor page building now.
> **The idea:** a surface where Atlas recommends how to make the estate more reliable, secure, and cost-efficient — **grounded in the customer's real graph**, ranked by impact, and **debatable** via Ask Atlas.
> **Cross-refs:** `docs/05` (graph/blast-radius), `docs/10` (AI, fact/advice trust model), `docs/plans/security-vulnerabilities.md`, `docs/plans/operational-intelligence.md`, `docs/plans/atlas-suite-vision.md` (this is the "Optimize" surface, adjacent to Aegis + the FinOps/Tally idea).

---

## 1. Why this fits Atlas (and why it's not generic advice)

Every tool — and ChatGPT — gives generic infra advice ("use Multi-AZ", "right-size"). The **only** reason to pay Atlas for it is that Atlas argues from *their actual system, with citations* (P1: graph is the product, AI is the interface; P4: provenance on everything). Not "add a standby" but: *"`rds-1` is single-AZ **and** 4 services depend on it (blast radius) — one AZ failure is a 4-service outage."* Grounded, cited, and impossible for a generic advisor to say.

The **argue-with-it** loop is the differentiator: a recommendation you can interrogate ("prove it", "what's the downside", "what if I don't") is far more trustworthy than a static list — and it's pure Ask-Atlas agentic loop.

## 2. The hard rule — never fabricate a number (this is the moat)

The whole value is trust, so we are explicit about what we can *prove today* vs. what needs data we don't ingest yet:

- **Architecture / reliability / security** → we have the graph → recommend + cite **now**.
- **Cost ($) and right-sizing (CPU/memory)** → we do **not** ingest Cost Explorer or CloudWatch utilization yet. We know what's *provisioned* (instance types, from the crawl) but not its *cost* or *utilization*. So any "$X saved" or "downsize, it's 5% used" would be **fabricated** — a P4/trust violation. It ships only once the data exists.

That split gives the two tiers.

## 3. Tier 1 — buildable NOW on the existing graph (no new data)

Recommendations derived from the graph + the posture findings we already compute, **ranked by impact** (severity × blast radius), each **cited** and **debatable**. Real material already exists on live estates:

- **Single points of failure** — single-AZ datastores; a resource N services depend on with no redundancy (from blast-radius).
- **Security posture** — world-open security groups, public-vs-name mismatches, wildcard IAM (the existing posture rules).
- **Sprawl / structural waste** — orphaned resources nothing points to, stopped/idle resources, unlinked infra.
- **Dependency risk** — the OSV vulns + their blast radius.
- **Delivery gaps** — services with no CI/CD link or no owner.

**Reuses:** `GraphService.summary()` findings (+ `firstSeenAt`/lifecycle), `guidanceFor(category)` (why/fix/pillar/source), the blast-radius traversal (`findingDetail` already unions the inbound closure of affected roots), and the Ask-Atlas **advisory** intent. So Tier 1 is mostly a new *surface* + a light impact-ranking, not new intelligence.

## 4. Tier 2 — the cost / memory numbers (needs 2 connectors)

- **AWS Cost Explorer / CUR** → real spend per resource/service → idle-resource $, over-provisioning $, Reserved-Instance / Savings-Plan opportunities, stopped-resource savings.
- **CloudWatch utilization** → CPU/memory → right-sizing with real deltas ("8% utilized → downsize → save $X").

Then recommendations carry **real dollar + utilization numbers** — the "difference in cost/memory" the product owner asked for. This is the **FinOps** surface (the "Tally" product in the suite vision). Until then, Optimize shows a Tier-2 teaser ("connect Cost Explorer to quantify savings") rather than inventing figures.

## 5. The argue / debate loop (stays honest via the fact/advice model)

Each recommendation has an **"Ask Atlas about this"** entry that opens the Ask-Atlas agentic loop, pre-seeded with the recommendation. The fact/advice trust model (`docs/10`) keeps it safe:

> **You:** "Add a standby? That doubles my DB cost."
> **Atlas:** "For *this* DB, ~2× the instance cost [fact, from the crawl]. Tradeoff: it's single-AZ and **4 services depend on it** [blast radius, cited] — an AZ failure is a 4-service outage. If those 4 aren't critical, maybe skip it — your call."

Facts are cited; the recommendation is labelled advice; tradeoffs are explicit; it never claims to be an oracle.

## 6. Ranking (Tier 1)

Impact score per recommendation = **severity weight × (1 + affected-resource count)**, with regressions boosted. Highest-impact first ("Fix these first"). The precise blast-radius closure is computed on the recommendation's detail view (reusing `findingDetail`), not for every row (cost).

## 7. First slice (this change)

The **`/advisor` page** (Tier 1): a ranked list of graph-grounded recommendations, each with why-it-matters (risk + affected/impact), the recommended fix (guidance), pillar/severity, and an **"Ask Atlas about this"** debate button — plus an honest header (what's covered now, cited) and a **Tier-2 cost teaser**. Reuses the `/insights` payload (findings + guidance) with client-side impact ranking — no new endpoint — and the `/ask?q=` debate deep-link. Nav entry added ("Advisor").

## 8. Definition of Done (per slice)
Grounded + cited (no fabricated numbers); reuses existing findings/guidance/blast-radius; `pnpm run check` green; board activity-log entry.
