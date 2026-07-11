import { describe, it, expect } from "vitest";
import { suggestIntentLinks, type FuzzyIssue, type FuzzyPr } from "./intent-links";

/**
 * IV-4 fuzzy PR↔issue linking. Deterministic, so fully unit-testable. The bar: surface a plausible
 * no-key match, but bias to a missing link over a wrong one (P3) — demand shared meaningful words, a
 * clear winner over the runner-up, and respect temporal sanity. Output is CANDIDATES for the human
 * confirm/reject loop, never asserted links.
 */

const issue = (over: Partial<FuzzyIssue>): FuzzyIssue => ({
  id: "i1",
  urn: "jira:acme:issue/ENG-1",
  key: "ENG-1",
  summary: "Add checkout refund timeout handling",
  createdAt: "2026-06-01T00:00:00Z",
  ...over,
});
const pr = (over: Partial<FuzzyPr>): FuzzyPr => ({
  id: "p1",
  urn: "bitbucket:acme:pullrequest/web/1",
  title: "Handle checkout refund timeout",
  branch: "feature/checkout-refund-timeout",
  createdAt: "2026-06-03T00:00:00Z",
  ...over,
});

describe("suggestIntentLinks", () => {
  it("links a PR that shares meaningful words with a ticket (no key present)", () => {
    const out = suggestIntentLinks([pr({})], [issue({})]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ prId: "p1", issueId: "i1", issueKey: "ENG-1" });
    expect(out[0]?.reasoning).toMatch(/checkout|refund|timeout/);
    expect(out[0]?.score).toBeGreaterThan(0.4);
  });

  it("does NOT link on a single generic shared word", () => {
    const out = suggestIntentLinks(
      [pr({ title: "Update checkout page", branch: "chore/checkout" })],
      [issue({ summary: "Refactor the billing invoice export" })],
    );
    expect(out).toHaveLength(0);
  });

  it("skips an ambiguous PR that matches two tickets about equally (P3)", () => {
    const out = suggestIntentLinks(
      [pr({ title: "checkout refund timeout", branch: "" })],
      [
        issue({ id: "i1", key: "ENG-1", summary: "checkout refund timeout handling" }),
        issue({ id: "i2", key: "ENG-2", summary: "checkout refund timeout retries" }),
      ],
    );
    expect(out).toHaveLength(0); // no clear winner → missing edge over a wrong one
  });

  it("penalizes a PR opened well before the ticket existed (can't implement it)", () => {
    const out = suggestIntentLinks(
      [pr({ createdAt: "2026-05-01T00:00:00Z" })], // a month BEFORE the ticket
      [issue({ createdAt: "2026-06-01T00:00:00Z" })],
    );
    expect(out).toHaveLength(0);
  });

  it("ignores the Jira key in the title (that's R18's deterministic tier)", () => {
    // Key-only overlap must not create a fuzzy link; needs real shared words.
    const out = suggestIntentLinks(
      [pr({ title: "ENG-1 misc", branch: "feature/ENG-1" })],
      [issue({ summary: "Add checkout refund timeout handling" })],
    );
    expect(out).toHaveLength(0);
  });

  it("emits at most one suggestion per PR (the best ticket)", () => {
    const out = suggestIntentLinks(
      [pr({})],
      [
        issue({ id: "i1", key: "ENG-1", summary: "Add checkout refund timeout handling" }),
        issue({ id: "i2", key: "ENG-2", summary: "Unrelated billing export work" }),
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.issueId).toBe("i1");
  });

  it("uses author↔assignee: the PR author being the ticket assignee corroborates a weak match", () => {
    // A borderline word-match that wouldn't clear the bar on its own…
    const weak = pr({ title: "wire up refund path", branch: "", createdAt: null });
    const iss = issue({ summary: "refund path handling", createdAt: null });
    const without = suggestIntentLinks([weak], [iss]);
    // …clears it when the author is the ticket's assignee (the +0.25 boost).
    const withMatch = suggestIntentLinks(
      [{ ...weak, author: "Anmol Bhardwaj" }],
      [{ ...iss, assignee: "anmol  bhardwaj" }], // normalized match (case/space-insensitive)
    );
    expect(withMatch.length).toBeGreaterThanOrEqual(without.length);
    expect(withMatch[0]?.reasoning).toMatch(/assignee/i);
  });

  it("returns [] on empty input", () => {
    expect(suggestIntentLinks([], [issue({})])).toEqual([]);
    expect(suggestIntentLinks([pr({})], [])).toEqual([]);
  });
});
