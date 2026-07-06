import { describe, expect, it } from "vitest";
import { runTool } from "./tools";
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
  name: "#3022 — pool tuning",
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
            title: "PR merged: #3022 — pool tuning",
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
  });

  it("get_pr_diff returns the diff tied to the PR node; unavailable → honest summary", async () => {
    const withDiff = await runTool(
      fakePort({}, "--- a/db/pool.ts\n+++ b/db/pool.ts\n-  max: 10\n+  max: 100"),
      "org-1",
      "get_pr_diff",
      { node_id: "pr-9" },
    );
    expect(withDiff.summary).toContain("db/pool.ts");
    expect(withDiff.diff?.prName).toBe("#3022 — pool tuning");
    expect(withDiff.nodes?.[0]?.id).toBe("pr-9");

    const without = await runTool(fakePort({}, null), "org-1", "get_pr_diff", {
      node_id: "pr-9",
    });
    expect(without.summary).toContain("no diff available");
  });
});
