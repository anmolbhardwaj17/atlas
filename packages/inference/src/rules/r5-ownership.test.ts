import { describe, it, expect } from "vitest";
import { ownershipPropagationRule } from "./r5-ownership";
import type { EdgeLite, InferenceInput } from "../types";

function makeInput(observedEdges: EdgeLite[], inferredEdges: EdgeLite[]): InferenceInput {
  return {
    orgSlug: "acme",
    nodesByUrn: new Map(),
    nodesByKind: new Map(),
    signals: [],
    signalsByKind: new Map(),
    observedEdges,
    inferredEdges,
  };
}
const ownedBy = (fromUrn: string, toUrn: string): EdgeLite => ({
  type: "OWNED_BY",
  fromUrn,
  toUrn,
});
const implementsEdge = (repoUrn: string, serviceUrn: string): EdgeLite => ({
  type: "IMPLEMENTS",
  fromUrn: repoUrn,
  toUrn: serviceUrn,
  tier: "inferred-high",
});

const REPO = "github:acme/orders";
const SERVICE = "atlas:acme:service:orders";
const TEAM = "github:acme:team:payments";

describe("R5 ownership_propagation", () => {
  it("observed repo→team ownership propagates to the service the repo IMPLEMENTS", () => {
    const out = ownershipPropagationRule.evaluate(
      makeInput([ownedBy(REPO, TEAM)], [implementsEdge(REPO, SERVICE)]),
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({
      type: "OWNED_BY",
      fromUrn: SERVICE,
      toUrn: TEAM,
      tier: "inferred-high",
    });
    expect(out.edges[0]?.evidence).toMatchObject({ via: REPO, source: "CODEOWNERS" });
  });

  it("no IMPLEMENTS for the owned repo ⇒ nothing to propagate to", () => {
    const out = ownershipPropagationRule.evaluate(makeInput([ownedBy(REPO, TEAM)], []));
    expect(out.edges).toEqual([]);
  });

  it("multiple owners on one repo ⇒ one OWNED_BY per owner, deduped", () => {
    const USER = "github:acme:user:alice";
    const out = ownershipPropagationRule.evaluate(
      makeInput(
        [ownedBy(REPO, TEAM), ownedBy(REPO, USER), ownedBy(REPO, TEAM)],
        [implementsEdge(REPO, SERVICE)],
      ),
    );
    expect(out.edges.map((e) => e.toUrn).sort()).toEqual([TEAM, USER].sort());
  });
});
