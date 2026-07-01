import { describe, it, expect } from "vitest";
import { bindCitations, detectUncitedClaims, scoreConfidence } from "./answer";
import type { Cite } from "./context";

const cites: Cite[] = [
  { marker: "N1", kind: "node", id: "n1", confidence: "observed" },
  { marker: "E1", kind: "edge", id: "e1", confidence: "inferred-high" },
];

describe("bindCitations (DD-5 deterministic binding)", () => {
  it("maps markers → real ids, dedupes, numbers by first appearance", () => {
    const out = bindCitations("impact [N1] via [E1] and again [N1]", cites);
    expect(out).toEqual([
      {
        number: 1,
        marker: "N1",
        kind: "node",
        id: "n1",
        confidence: "observed",
        provenanceUrl: "/api/v1/nodes/n1",
      },
      {
        number: 2,
        marker: "E1",
        kind: "edge",
        id: "e1",
        confidence: "inferred-high",
        provenanceUrl: "/api/v1/edges/e1",
      },
    ]);
  });
  it("drops markers with no matching context fact (can't fabricate a source)", () => {
    expect(bindCitations("see [N9]", cites)).toEqual([]);
  });
});

describe("detectUncitedClaims (L5)", () => {
  it("flags a factual sentence with no marker, ignores cited + hedge sentences", () => {
    const narration =
      "Deleting checkout [N1] impacts orders-api [E1]. It also connects to a hidden payments service somewhere. I don't have data on the eu-west region.";
    const flagged = detectUncitedClaims(narration);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatch(/hidden payments service/);
  });
});

describe("scoreConfidence (weakest link, docs/10 §5)", () => {
  it("returns the weakest cited tier", () => {
    expect(
      scoreConfidence(
        [
          {
            number: 1,
            marker: "N1",
            kind: "node",
            id: "n1",
            confidence: "observed",
            provenanceUrl: "",
          },
          {
            number: 2,
            marker: "E1",
            kind: "edge",
            id: "e1",
            confidence: "inferred-low",
            provenanceUrl: "",
          },
        ],
        cites,
      ),
    ).toBe("inferred-low");
  });
  it("falls back to all-context cites when narration cited none", () => {
    expect(scoreConfidence([], cites)).toBe("inferred-high"); // weakest of observed + inferred-high
  });
});
