import { describe, it, expect } from "vitest";
import { groundingGate } from "./grounding";
import type { RetrievalResult } from "./retrieval";
import type { RetrievedNode, EstateOverview } from "./retrieval-port";

/**
 * The Grounding Gate (docs/10 §4.5, DD-4) is the deterministic honest-absence control: a refusal is
 * a SUCCESS (P3/US-11), and a resolved entity with an EMPTY traversal is still grounded ("nothing
 * depends on X" is a truthful answer, not a gap). These are the cases that separate an honest "I
 * don't know" from a plausible fabrication, so they get first-class coverage.
 */

const node: RetrievedNode = {
  id: "n1",
  urn: "aws:us-east-1:1:rds:orders",
  kind: "aws.rds.instance",
  name: "orders",
  status: "active",
  confidence: "observed",
  region: "us-east-1",
  provenance: { source: "aws", rawSnapshotRef: null },
};

const estate: EstateOverview = {} as EstateOverview;

function result(
  partial: Partial<RetrievalResult> & Pick<RetrievalResult, "intent">,
): RetrievalResult {
  return { mention: null, ambiguous: false, ...partial };
}

describe("groundingGate", () => {
  it("out_of_scope ⇒ NOT grounded, with an in-scope-only reason (never fabricate outside the graph)", () => {
    const g = groundingGate(result({ intent: "out_of_scope" }));
    expect(g.grounded).toBe(false);
    expect(g.reason).toMatch(/outside|only answer/i);
  });

  it("an unresolved entity ⇒ NOT grounded, and the reason names what was searched (US-11)", () => {
    const g = groundingGate(result({ intent: "blast_radius", mention: "paymentz-db" }));
    expect(g.grounded).toBe(false);
    expect(g.reason).toContain("paymentz-db");
  });

  it('an unresolved entity with no mention falls back to "that", not a blank', () => {
    const g = groundingGate(result({ intent: "dependents", mention: null }));
    expect(g.grounded).toBe(false);
    expect(g.reason).toContain("that");
  });

  it('a RESOLVED entity with an EMPTY traversal is STILL grounded — "nothing depends on X" is truthful (P3)', () => {
    const g = groundingGate(result({ intent: "dependents", rootNode: node, edges: [] }));
    expect(g.grounded).toBe(true);
    expect(g.reason).toBeUndefined();
  });

  it('timeline is grounded even for an empty window ("nothing changed" is an answer)', () => {
    const g = groundingGate(result({ intent: "timeline", timeline: [] }));
    expect(g.grounded).toBe(true);
  });

  it("estate is grounded when the snapshot loaded (even a near-empty estate)", () => {
    const g = groundingGate(result({ intent: "estate", estate }));
    expect(g.grounded).toBe(true);
  });

  it("estate WITHOUT a snapshot ⇒ NOT grounded, blamed on a sync-in-progress (never a faked overview)", () => {
    const g = groundingGate(result({ intent: "estate" }));
    expect(g.grounded).toBe(false);
    expect(g.reason).toMatch(/syncing/i);
  });
});
