/**
 * Knowledge packs (docs/plans/ai-knowledge-engine.md §5, P2). Curated, versioned DOMAIN
 * expertise (Layer B) the advisory answer uses to explain *why a grounded finding matters* and
 * *how to fix it*. Kept as data (not prompt spaghetti) and keyed by the finding `category` that
 * `GraphService.summary` produces - so it's provider-agnostic (code hygiene applies to Bitbucket
 * and GitHub alike) and extensible: AWS/Bitbucket-specific categories slot in as connectors land.
 *
 * The hard rule (the fact/advice trust model): guidance is ADVICE, never a customer fact. Facts
 * come only from the graph (cited); guidance is the reference the narrator turns into a labelled
 * recommendation anchored to a cited finding. `why`/`fix` are best-practice, attributable via
 * `source` (e.g. AWS Well-Architected), never invented per-customer.
 */

export const KNOWLEDGE_PACK_VERSION = "atlas-knowledge@1";

export interface Guidance {
  /** Why this finding matters (best-practice rationale). */
  why: string;
  /** The concrete fix / optimisation lever (for the human - Atlas never mutates their cloud, P2). */
  fix: string;
  /** The pillar/dimension this improves (cost, security, reliability, performance, hygiene). */
  pillar: "security" | "reliability" | "cost" | "performance" | "hygiene" | "operations";
  /** Attribution for the guidance (so advice cites a source, not raw model opinion). */
  source: string;
}

/**
 * Guidance keyed by the finding category (case-insensitive). Categories currently emitted by the
 * graph are covered; AWS categories are seeded ready for the connector (they produce no findings
 * yet, so they simply don't appear until AWS is connected).
 */
const GUIDANCE: Record<string, Guidance> = {
  // --- live now (code hosts: Bitbucket / GitHub) ---
  "code hygiene": {
    why: "Repositories without a CI/CD pipeline ship changes with no automated build, test, or security gate - regressions and vulnerabilities reach production unchecked, and releases are manual and error-prone.",
    fix: "Add a pipeline (Bitbucket Pipelines / GitHub Actions) that at minimum builds, runs tests, and blocks merge on failure; add dependency + secret scanning as a next step.",
    pillar: "hygiene",
    source: "CI/CD best practice (DORA)",
  },
  "blast radius": {
    why: "A single component many others depend on is a single point of failure - its outage cascades widely, and it's a bottleneck for change.",
    fix: "Reduce fan-in: add redundancy/failover for it, introduce a queue or cache to decouple dependents, or split its responsibilities so no one node is load-bearing for the whole estate.",
    pillar: "reliability",
    source: "AWS Well-Architected - Reliability",
  },
  vulnerabilities: {
    why: "A known vulnerability (CVE/GHSA) in a dependency is code an attacker already has a documented exploit for - it ships to production with your app, and the blast radius is every repo that pulls the package in.",
    fix: "Upgrade each affected package to its patched (fixed) version; prioritise critical/high severity and packages many repos share, and add dependency scanning to CI so new ones surface at PR time, not in production.",
    pillar: "security",
    source: "OWASP A06:2021 - Vulnerable & Outdated Components",
  },
  "dependency sprawl": {
    why: "The same package pinned to many different versions across repos means inconsistent behaviour, duplicated review effort, and a harder, riskier single upgrade when a vulnerability lands in that package.",
    fix: "Converge on one supported version (a shared/catalog version or a renovate-style policy), and remove unused or wildly outdated pins so a future security upgrade is one change, not a scavenger hunt.",
    pillar: "hygiene",
    source: "Dependency management best practice (SLSA / supply-chain)",
  },
  "source health": {
    why: "A degraded or disconnected source means the graph is going stale for that provider - answers and findings silently drift from reality.",
    fix: "Reconnect the source / rotate its credentials and re-sync so coverage is current; check the connector's least-privilege role is still valid.",
    pillar: "operations",
    source: "Atlas operational guidance",
  },
  freshness: {
    why: "Stale resources are ones Atlas hasn't re-observed recently - decisions made on them may be based on out-of-date state.",
    fix: "Trigger a re-sync of the affected scope; if a resource is genuinely gone, ensure the source still has read access so deletions are observed.",
    pillar: "operations",
    source: "Atlas operational guidance",
  },
  "cross-boundary": {
    why: "Connections that span a cloud or account boundary widen the blast radius and the attack surface, and often incur cross-region/egress cost - they deserve explicit review.",
    fix: "Confirm each cross-boundary link is intentional; where possible keep tightly-coupled components in one account/region, and put explicit controls (peering, private links, scoped IAM) on the ones that must cross.",
    pillar: "security",
    source: "AWS Well-Architected - Security & Cost",
  },

  // --- seeded for AWS (no findings until the connector lands; ready when it does) ---
  "public exposure": {
    why: "A resource reachable from the public internet on a sensitive port is a critical exposure - especially a datastore, which should never be internet-facing.",
    fix: "Restrict the security group ingress to the specific app tier (source SG), not 0.0.0.0/0; put public entry behind a load balancer/WAF and keep data tiers private.",
    pillar: "security",
    source: "AWS Well-Architected - Security",
  },
  encryption: {
    why: "Data stored without encryption at rest fails most compliance regimes and exposes it if the underlying media or a snapshot is compromised.",
    fix: "Enable encryption at rest (KMS) on the datastore/volume; for existing unencrypted resources, create an encrypted copy/snapshot and cut over.",
    pillar: "security",
    source: "AWS Well-Architected - Security",
  },
  iam: {
    why: "Over-broad IAM permissions (wildcards) violate least-privilege - a compromised principal can do far more damage than its job requires.",
    fix: "Scope policies to the specific actions and resources needed; replace `*` with explicit ARNs and actions, and prefer roles over long-lived keys.",
    pillar: "security",
    source: "AWS Well-Architected - Security",
  },
  "security posture": {
    why: "A world-open security group or an unintentionally internet-facing load balancer is a direct attack surface - anyone on the internet can reach the ports it exposes, and it turns every vulnerability behind it into a remotely exploitable one.",
    fix: "Restrict ingress CIDRs to known networks (VPN/office/peered VPCs), put internet-facing entry points behind a WAF, and make the scheme match intent - a 'private' load balancer should be internal. Re-verify with the map's Security toggle after each change.",
    pillar: "security",
    source: "AWS Well-Architected - Security",
  },
  cost: {
    why: "Idle or oversized resources bill continuously for capacity you don't use.",
    fix: "Rightsize to observed utilisation, adopt reserved/savings plans for steady workloads, and add lifecycle policies to expire unused storage/snapshots.",
    pillar: "cost",
    source: "AWS Well-Architected - Cost Optimization",
  },
};

/** Best-practice guidance for a finding category, or null if the pack has none (advise cautiously). */
export function guidanceFor(category: string): Guidance | null {
  return GUIDANCE[category.trim().toLowerCase()] ?? null;
}
