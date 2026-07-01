import { describe, it, expect } from "vitest";
import { serviceDerivationRule } from "./r4-service";
import { ownershipPropagationRule } from "./r5-ownership";
import { prChangesServiceRule } from "./r6-changed";
import type { EdgeLite, InferenceInput, NodeLite, SignalLite } from "../types";

function makeInput(p: {
  nodes?: NodeLite[];
  signals?: SignalLite[];
  observedEdges?: EdgeLite[];
  inferredEdges?: EdgeLite[];
  orgSlug?: string;
}): InferenceInput {
  const nodesByUrn = new Map<string, NodeLite>();
  const nodesByKind = new Map<string, NodeLite[]>();
  for (const n of p.nodes ?? []) {
    nodesByUrn.set(n.urn, n);
    const l = nodesByKind.get(n.kind);
    if (l) l.push(n);
    else nodesByKind.set(n.kind, [n]);
  }
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of p.signals ?? []) {
    const l = signalsByKind.get(s.kind);
    if (l) l.push(s);
    else signalsByKind.set(s.kind, [s]);
  }
  return {
    orgSlug: p.orgSlug ?? "acme",
    nodesByUrn,
    nodesByKind,
    signals: p.signals ?? [],
    signalsByKind,
    observedEdges: p.observedEdges ?? [],
    inferredEdges: p.inferredEdges ?? [],
  };
}

const REPO = "github:acme/orders-svc";
const ECS = "aws:us-east-1:123456789012:ecs-service:prod/orders";
const SERVICE = "atlas:acme:service:orders-svc";
const TEAM = "github:acme:team:payments";
const deploy = (tier: "inferred-high" | "inferred-low"): EdgeLite => ({
  type: "DEPLOYS_TO",
  fromUrn: REPO,
  toUrn: ECS,
  tier,
});

describe("R4 service_derivation", () => {
  it("derives atlas.service + IMPLEMENTS(repo) + RUNS(runtime) from a high DEPLOYS_TO", () => {
    const out = serviceDerivationRule.evaluate(
      makeInput({ inferredEdges: [deploy("inferred-high")] }),
    );
    expect(out.nodes).toEqual([
      {
        urn: SERVICE,
        kind: "atlas.service",
        displayName: "orders-svc",
        attributes: { key: "orders-svc", derivedFrom: REPO },
        tier: "inferred-high",
      },
    ]);
    expect(out.edges).toEqual([
      expect.objectContaining({
        type: "IMPLEMENTS",
        fromUrn: REPO,
        toUrn: SERVICE,
        tier: "inferred-high",
      }),
      expect.objectContaining({
        type: "RUNS",
        fromUrn: ECS,
        toUrn: SERVICE,
        tier: "inferred-high",
      }),
    ]);
  });

  it("ignores low-confidence deploys (DD-1: service only from high)", () => {
    const out = serviceDerivationRule.evaluate(
      makeInput({ inferredEdges: [deploy("inferred-low")] }),
    );
    expect(out.nodes).toEqual([]);
    expect(out.edges).toEqual([]);
  });

  it("one service node for a repo deploying to two runtimes (RUNS ×2)", () => {
    const ecs2 = "aws:us-east-1:123456789012:lambda:orders-worker";
    const out = serviceDerivationRule.evaluate(
      makeInput({
        inferredEdges: [
          deploy("inferred-high"),
          { type: "DEPLOYS_TO", fromUrn: REPO, toUrn: ecs2, tier: "inferred-high" },
        ],
      }),
    );
    expect(out.nodes).toHaveLength(1);
    expect(
      out.edges
        .filter((e) => e.type === "RUNS")
        .map((e) => e.fromUrn)
        .sort(),
    ).toEqual([ECS, ecs2].sort());
    expect(out.edges.filter((e) => e.type === "IMPLEMENTS")).toHaveLength(1);
  });
});

describe("R5 ownership_propagation", () => {
  it("propagates observed repo OWNED_BY to the service the repo IMPLEMENTS", () => {
    const out = ownershipPropagationRule.evaluate(
      makeInput({
        observedEdges: [{ type: "OWNED_BY", fromUrn: REPO, toUrn: TEAM }],
        inferredEdges: [
          { type: "IMPLEMENTS", fromUrn: REPO, toUrn: SERVICE, tier: "inferred-high" },
        ],
      }),
    );
    expect(out.edges).toEqual([
      expect.objectContaining({
        type: "OWNED_BY",
        fromUrn: SERVICE,
        toUrn: TEAM,
        tier: "inferred-high",
      }),
    ]);
  });

  it("emits nothing without an IMPLEMENTS link", () => {
    const out = ownershipPropagationRule.evaluate(
      makeInput({ observedEdges: [{ type: "OWNED_BY", fromUrn: REPO, toUrn: TEAM }] }),
    );
    expect(out.edges).toEqual([]);
  });
});

describe("R6 pr_changes_service", () => {
  const prSignal = (files: string[], mergedAt: string | null): SignalLite => ({
    subjectUrn: "github:acme/orders-svc:pr:482",
    kind: "github.pr.files",
    data: { files, mergedAt },
  });
  const implements1: EdgeLite = {
    type: "IMPLEMENTS",
    fromUrn: REPO,
    toUrn: SERVICE,
    tier: "inferred-high",
  };

  it("merged PR + single implemented service → high CHANGED_BY(service→pr)", () => {
    const out = prChangesServiceRule.evaluate(
      makeInput({
        signals: [prSignal(["src/a.ts"], "2026-06-30T00:00:00Z")],
        inferredEdges: [implements1],
      }),
    );
    expect(out.edges).toEqual([
      expect.objectContaining({
        type: "CHANGED_BY",
        fromUrn: SERVICE,
        toUrn: "github:acme/orders-svc:pr:482",
        tier: "inferred-high",
      }),
    ]);
  });

  it("monorepo (two services) → inferred-low each (P3)", () => {
    const svc2 = "atlas:acme:service:other";
    const out = prChangesServiceRule.evaluate(
      makeInput({
        signals: [prSignal(["x"], "2026-06-30T00:00:00Z")],
        inferredEdges: [
          implements1,
          { type: "IMPLEMENTS", fromUrn: REPO, toUrn: svc2, tier: "inferred-high" },
        ],
      }),
    );
    expect(out.edges).toHaveLength(2);
    expect(out.edges.every((e) => e.tier === "inferred-low")).toBe(true);
  });

  it("ignores unmerged PRs", () => {
    const out = prChangesServiceRule.evaluate(
      makeInput({ signals: [prSignal(["x"], null)], inferredEdges: [implements1] }),
    );
    expect(out.edges).toEqual([]);
  });
});
