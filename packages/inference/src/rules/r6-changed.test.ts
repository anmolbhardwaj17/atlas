import { describe, it, expect } from "vitest";
import { prChangesServiceRule } from "./r6-changed";
import type { EdgeLite, InferenceInput, SignalLite } from "../types";

function makeInput(signals: SignalLite[], inferredEdges: EdgeLite[]): InferenceInput {
  const signalsByKind = new Map<string, SignalLite[]>();
  for (const s of signals) {
    const list = signalsByKind.get(s.kind) ?? [];
    list.push(s);
    signalsByKind.set(s.kind, list);
  }
  return {
    orgSlug: "acme",
    nodesByUrn: new Map(),
    nodesByKind: new Map(),
    signals,
    signalsByKind,
    observedEdges: [],
    inferredEdges,
  };
}
const prFiles = (prUrn: string, mergedAt: string | null, files: string[] = []): SignalLite => ({
  subjectUrn: prUrn,
  kind: "github.pr.files",
  data: { files, mergedAt },
});
const implementsEdge = (repoUrn: string, serviceUrn: string): EdgeLite => ({
  type: "IMPLEMENTS",
  fromUrn: repoUrn,
  toUrn: serviceUrn,
  tier: "inferred-high",
});

const REPO = "github:acme/orders";
const PR = "github:acme/orders:pr:42";
const SERVICE = "atlas:acme:service:orders";

describe("R6 pr_changes_service", () => {
  it("a merged PR in a repo implementing exactly ONE service ⇒ CHANGED_BY (high)", () => {
    const out = prChangesServiceRule.evaluate(
      makeInput(
        [prFiles(PR, "2026-01-01T00:00:00Z", ["src/a.ts"])],
        [implementsEdge(REPO, SERVICE)],
      ),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({
      type: "CHANGED_BY",
      fromUrn: SERVICE,
      toUrn: PR,
      tier: "inferred-high",
    });
    expect(out.edges[0]?.evidence).toMatchObject({ pr: PR, mergedAt: "2026-01-01T00:00:00Z" });
  });

  it("a monorepo (repo implements MANY services) ⇒ CHANGED_BY (LOW) for each — honest culprit uncertainty (P3, US-6)", () => {
    const SERVICE_2 = "atlas:acme:service:orders-api";
    const out = prChangesServiceRule.evaluate(
      makeInput(
        [prFiles(PR, "2026-01-01T00:00:00Z")],
        [implementsEdge(REPO, SERVICE), implementsEdge(REPO, SERVICE_2)],
      ),
    );
    expect(out.edges).toHaveLength(2);
    expect(out.edges.every((e) => e.tier === "inferred-low")).toBe(true);
  });

  it("an UNMERGED PR (no mergedAt) ⇒ no edge — only merged changes count", () => {
    const out = prChangesServiceRule.evaluate(
      makeInput([prFiles(PR, null)], [implementsEdge(REPO, SERVICE)]),
    );
    expect(out.edges).toEqual([]);
  });

  it("a merged PR in a repo implementing NO service ⇒ no edge", () => {
    const out = prChangesServiceRule.evaluate(makeInput([prFiles(PR, "2026-01-01T00:00:00Z")], []));
    expect(out.edges).toEqual([]);
  });
});
