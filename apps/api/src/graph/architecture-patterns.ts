/**
 * Architecture patterns for the Advisor (docs/plans/optimization.md). Each pattern is a PURE
 * function over the graph that detects a structural anti-pattern and emits a Proposal carrying a
 * small before/after subgraph — the "current" (observed) shape and the "proposed" (recommended)
 * one, with added/changed/removed nodes flagged.
 *
 * The proposals are GENERATIVE (Atlas suggesting a redesign), so they are anchored to real facts
 * (a DB really is single-AZ; an EC2 really has no load balancer) and clearly labelled as
 * recommendations by the caller — never asserted as observed truth (P3/P4, the trust moat).
 */

export type ArchState = "added" | "changed" | "removed";

export interface ArchNode {
  id: string;
  label: string;
  kind: string;
  /** Absent = an existing (current) node; set = the delta the proposal introduces. */
  state?: ArchState;
  note?: string;
}
export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
  state?: ArchState;
}
export interface ArchSubgraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
}
export interface Proposal {
  id: string;
  title: string;
  category: "reliability" | "scalability" | "security" | "cost";
  /** Higher = surface first. */
  impact: number;
  rationale: string;
  tradeoff: string;
  current: ArchSubgraph;
  proposed: ArchSubgraph;
  /** URNs of the real nodes this proposal is about (citations + the discuss loop). */
  evidence: string[];
}

/** The slice of a graph node the patterns read. */
export interface PatternNode {
  id: string;
  urn: string;
  kind: string;
  name: string;
  attributes: Record<string, unknown>;
}
export interface PatternEdge {
  from: string;
  to: string;
  type: string;
}

// EC2 names that clearly aren't user-facing app servers — proposing an ALB/ECS for a VPN, bastion,
// CI or migration box is noise. We still allow ambiguous names through (the user can argue them
// down in the discuss loop), we just skip the obvious infra roles (P3: fewer wrong proposals).
const NON_APP_EC2 = /vpn|bastion|jenkins|migrat|nat[-_]?gw|nat[-_]?instance|\bcli\b|\btool/i;

/** Run every pattern over the graph. `dependents(id)` = how many nodes point AT this node. */
export function architectureProposals(
  nodes: PatternNode[],
  edges: PatternEdge[],
  dependents: (id: string) => number,
): Proposal[] {
  const proposals: Proposal[] = [];

  // ── Pattern A — single-AZ database → Multi-AZ ────────────────────────────────
  for (const n of nodes) {
    if (n.kind !== "aws.rds.instance" || n.attributes.multiAz !== false) continue;
    const deps = dependents(n.id);
    const standby = `${n.id}::standby`;
    const depClause = deps
      ? ` and ${deps} resource${deps === 1 ? "" : "s"} depend${deps === 1 ? "s" : ""} on it`
      : "";
    proposals.push({
      id: `multiaz:${n.id}`,
      title: `Make ${n.name} Multi-AZ`,
      category: "reliability",
      impact: 100 * (1 + deps),
      rationale: `${n.name} runs in a single Availability Zone${depClause}. If that AZ has an outage, the database — and everything relying on it — goes down.`,
      tradeoff: `Adds a synchronous standby in a second AZ (~2× the DB instance cost) for automatic failover with no data loss. No application changes.`,
      current: { nodes: [{ id: n.id, label: n.name, kind: n.kind }], edges: [] },
      proposed: {
        nodes: [
          { id: n.id, label: n.name, kind: n.kind },
          {
            id: standby,
            label: `${n.name} (standby)`,
            kind: n.kind,
            state: "added",
            note: "second AZ",
          },
        ],
        edges: [{ from: n.id, to: standby, label: "Multi-AZ replication", state: "added" }],
      },
      evidence: [n.urn],
    });
  }

  // ── Pattern B — standalone EC2 → ECS/Fargate behind an ALB + auto-scaling ─────
  const behindLb = new Set<string>();
  for (const e of edges) if (e.type === "ROUTES_TO") behindLb.add(e.to);
  for (const n of nodes) {
    if (n.kind !== "aws.ec2.instance" || behindLb.has(n.id) || NON_APP_EC2.test(n.name)) continue;
    const alb = `${n.id}::alb`;
    const svc = `${n.id}::svc`;
    const t1 = `${n.id}::t1`;
    const t2 = `${n.id}::t2`;
    proposals.push({
      id: `ecsalb:${n.id}`,
      title: `Move ${n.name} to ECS Fargate behind a load balancer`,
      category: "scalability",
      impact: 60,
      rationale: `${n.name} runs on a single EC2 instance with no load balancer in front. If it serves application traffic, that instance is a single point of failure and can't scale horizontally.`,
      tradeoff: `Containerize on ECS Fargate behind an Application Load Balancer with auto-scaling: zero-downtime deploys, horizontal scale, and no servers to patch — for the cost of the ALB + a second task. (If this box isn't user-facing — a VPN, CI, or utility host — tell Atlas in the discussion and it'll drop the suggestion.)`,
      current: { nodes: [{ id: n.id, label: n.name, kind: n.kind }], edges: [] },
      proposed: {
        nodes: [
          { id: alb, label: "Application Load Balancer", kind: "aws.elb", state: "added" },
          {
            id: svc,
            label: `${n.name} service`,
            kind: "aws.ecs.service",
            state: "added",
            note: "Fargate · auto-scaling",
          },
          { id: t1, label: "task", kind: "aws.ecs.taskdef", state: "added" },
          { id: t2, label: "task", kind: "aws.ecs.taskdef", state: "added" },
        ],
        edges: [
          { from: alb, to: svc, label: "routes to", state: "added" },
          { from: svc, to: t1, state: "added" },
          { from: svc, to: t2, state: "added" },
        ],
      },
      evidence: [n.urn],
    });
  }

  return proposals.sort((a, b) => b.impact - a.impact);
}
