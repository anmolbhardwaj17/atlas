import { describe, expect, it } from "vitest";
import { runTool, rankHypotheses } from "./tools";
import { ContextAccumulator } from "./loop";
import type { NodeEventFact, RetrievalPort, RetrievedNode } from "./retrieval-port";

/** Phase D (operational-intelligence): diagnose + get_pr_diff. Deterministic tool-level
 *  evals - the golden incident (deploy + PR merge near the failure) and the adversarial
 *  quiet window (must say "no likely culprit", never invent one). */

const RDS: RetrievedNode = {
  id: "rds-1",
  urn: "aws:us-east-1:851725189424:rds:calsaws-rds-instance-1",
  kind: "aws.rds.instance",
  name: "calsaws-rds-instance-1",
  status: "active",
  confidence: "observed",
  region: "us-east-1",
  health: { state: "unhealthy", reason: "instance status: stopped" },
  provenance: null,
};
const PR: RetrievedNode = {
  id: "pr-9",
  urn: "bitbucket:siemba:pullrequest/chat-api/3022",
  kind: "bitbucket.pullrequest",
  name: "#3022 - pool tuning",
  status: "active",
  confidence: "observed",
  region: null,
  provenance: null,
};

const recent = (minAgo: number): string => new Date(Date.now() - minAgo * 60_000).toISOString();

function fakePort(events: Record<string, NodeEventFact[]>, diff: string | null): RetrievalPort {
  return {
    search: async () => [],
    getNode: async (_o, id) => (id === RDS.id ? RDS : id === PR.id ? PR : null),
    blastRadius: async () => ({
      root: { id: RDS.id, urn: RDS.urn, kind: RDS.kind, name: RDS.name },
      impacted: [
        {
          node: { id: "svc-1", urn: "u", kind: "aws.ecs.service", name: "api" },
          distance: 1,
          via: [
            {
              edgeId: "e-1",
              type: "CONNECTS_TO",
              confidence: "inferred-high",
              evidence: {},
              rule: null,
            },
          ],
          pathConfidence: "inferred-high",
        },
      ],
      warnings: [],
      truncated: false,
    }),
    dependencies: async () => ({
      root: { id: RDS.id, urn: RDS.urn, kind: RDS.kind, name: RDS.name },
      impacted: [],
      warnings: [],
      truncated: false,
    }),
    edges: async () => [
      {
        id: "e-deploy",
        type: "DEPLOYS_TO",
        confidence: "inferred-high",
        from: { id: "repo-1", urn: "bitbucket:siemba:repository/chat-api", name: "chat-api" },
        to: { id: RDS.id, urn: RDS.urn, name: RDS.name },
      },
    ],
    timeline: async () => [],
    nodeEvents: async (_o, nodeId) => events[nodeId] ?? [],
    prDiff: async () => (diff ? { text: diff, truncated: false } : null),
    estateOverview: async () => {
      throw new Error("not used");
    },
  };
}

describe("diagnose (Phase D)", () => {
  it("golden incident: health + deployer's recent merge + config change land as citable events", async () => {
    const port = fakePort(
      {
        "rds-1": [
          {
            id: "ev-1",
            kind: "config_change",
            occurredAt: recent(30),
            actor: "readonly-anmol",
            title: "ModifyDBInstance by readonly-anmol",
            source: "cloudtrail",
          },
        ],
        "repo-1": [
          {
            id: "ev-2",
            kind: "pr_merged",
            occurredAt: recent(45),
            actor: "dev-a",
            title: "PR merged: #3022 - pool tuning",
            source: "graph",
          },
        ],
      },
      null,
    );
    const out = await runTool(port, "org-1", "diagnose", { node_id: "rds-1", hours: 24 });
    expect(out.summary).toContain("health: unhealthy (instance status: stopped)");
    expect(out.summary).toContain("ModifyDBInstance");
    expect(out.summary).toContain("deployer chat-api");
    expect(out.summary).toContain("PR merged: #3022");
    expect(out.events).toHaveLength(2);

    // Events become citable A-marker facts in the accumulated context.
    const acc = new ContextAccumulator();
    acc.add(out);
    const built = acc.build("org-1");
    expect(built.context).toContain("CHANGE TIMELINE");
    expect(built.context).toContain("ModifyDBInstance");
    const eventCites = built.cites.filter((c) => c.id.startsWith("event:"));
    expect(eventCites).toHaveLength(2);
    expect(eventCites.every((c) => /^A\d+$/.test(c.marker))).toBe(true);
  });

  it("adversarial quiet window: instructs honest absence, never invents", async () => {
    const port = fakePort({}, null);
    const out = await runTool(port, "org-1", "diagnose", { node_id: "rds-1", hours: 24 });
    expect(out.summary).toContain("no recorded changes on it in the last 24h");
    expect(out.summary).toContain("no likely culprit was found");
    expect(out.events).toBeUndefined();
    // No candidate changes → no hypotheses at all (never a fabricated one).
    expect(out.hypotheses).toBeUndefined();
  });

  it("ranks candidate changes deterministically and classifies each verdict", async () => {
    const port = fakePort(
      {
        "rds-1": [
          {
            id: "ev-cfg",
            kind: "config_change",
            occurredAt: recent(20),
            actor: "readonly-anmol",
            title: "ModifyDBInstance",
            source: "cloudtrail",
          },
          {
            // A symptom, not a cause — must never become a hypothesis.
            id: "ev-health",
            kind: "health_transition",
            occurredAt: recent(15),
            actor: null,
            title: "Health healthy → unhealthy",
            source: "health-poll",
          },
        ],
        "repo-1": [
          {
            id: "ev-pr",
            kind: "pr_merged",
            occurredAt: recent(90),
            actor: "dev-a",
            title: "PR merged: #3022 - pool tuning",
            source: "graph",
          },
        ],
      },
      null,
    );
    const out = await runTool(port, "org-1", "diagnose", { node_id: "rds-1", hours: 24 });
    const h = out.hypotheses ?? [];
    // Two candidates (config change + deployer PR); the health transition is excluded.
    expect(h.map((x) => x.eventId)).toEqual(["ev-cfg", "ev-pr"]);
    expect(h.some((x) => x.kind === "health_transition")).toBe(false);
    // Nearer-to-onset config change on the node outranks the older, one-hop-away PR.
    expect(h[0]?.eventId).toBe("ev-cfg");
    expect(h[0]?.verdict).toBe("config-change");
    expect(h[0]?.distance).toBe(0);
    expect(h[1]?.verdict).toBe("code-change");
    expect(h[0]?.score).toBeGreaterThan(h[1]?.score ?? 0);
    // The ranking is surfaced in the model-facing summary too.
    expect(out.summary).toContain("ranked likely causes");
  });

  it("rankHypotheses demotes a change that happened AFTER the failure onset (likely a fix)", () => {
    const onset = Date.now() - 60 * 60_000; // broke 1h ago
    const before: NodeEventFact = {
      id: "before",
      kind: "deploy",
      occurredAt: new Date(onset - 10 * 60_000).toISOString(), // 10m before onset
      actor: null,
      title: "deploy A",
      source: "s",
    };
    const after: NodeEventFact = {
      id: "after",
      kind: "deploy",
      occurredAt: new Date(onset + 30 * 60_000).toISOString(), // 30m after onset (a remediation)
      actor: null,
      title: "deploy B",
      source: "s",
    };
    const ranked = rankHypotheses("svc", onset, 24, [
      { event: after, subject: "svc", distance: 0 },
      { event: before, subject: "svc", distance: 0 },
    ]);
    expect(ranked[0]?.eventId).toBe("before"); // the pre-onset change is the suspect
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("get_pr_diff returns the diff tied to the PR node; unavailable → honest summary", async () => {
    const withDiff = await runTool(
      fakePort({}, "--- a/db/pool.ts\n+++ b/db/pool.ts\n-  max: 10\n+  max: 100"),
      "org-1",
      "get_pr_diff",
      { node_id: "pr-9" },
    );
    expect(withDiff.summary).toContain("db/pool.ts");
    expect(withDiff.diff?.prName).toBe("#3022 - pool tuning");
    expect(withDiff.nodes?.[0]?.id).toBe("pr-9");

    const without = await runTool(fakePort({}, null), "org-1", "get_pr_diff", {
      node_id: "pr-9",
    });
    expect(without.summary).toContain("no diff available");
  });
});
