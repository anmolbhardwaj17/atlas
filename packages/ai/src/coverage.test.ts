import { describe, it, expect } from "vitest";
import {
  judgeCoverage,
  extractAcceptanceCriteria,
  segmentDiff,
  parseCoverageLines,
  type CoverageInputs,
  type IntentIssue,
} from "./coverage";
import { MockLLMProvider } from "./mock-provider";

/**
 * IV-3 intent-coverage eval (docs/plans/intent-verification.md §honesty). The bar mirrors G3's
 * escaped-hallucination-zero: a planted intent GAP must surface as a hedged, cited question, and a
 * correctly-implemented PR must NOT be flagged. Correctness rests on the DETERMINISTIC suppression
 * gate, so these run against a MockLLMProvider (canned judgments) - we assert the gate's structural
 * guarantees independent of any real model's stochasticity. Real-model precision is a live check.
 */

const DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index 0000000..1111111 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,3 +10,8 @@ export function login(user) {
+  if (!user.emailVerified) {
+    throw new Error("email not verified");
+  }
   return createSession(user);
@@ -30,2 +38,4 @@ export function logout(session) {
+  clearSession(session);
   return true;`;

/** A ticket whose ACs are: email-verify (built), logout-clear (built), rate-limit (NOT built). */
const ISSUE: IntentIssue = {
  id: "issue-1",
  key: "ENG-142",
  url: "https://acme.atlassian.net/browse/ENG-142",
  summary: "Harden the login flow",
  description: `As a user I want my login to be secure.

Acceptance Criteria:
- Email must be verified before a session is created
- The session is cleared on logout
- Failed login attempts are rate limited`,
  subtasks: [],
  comments: [{ author: "PM", text: "Rate limiting is the important one for the audit." }],
};

const inputs = (issue: IntentIssue | null, diff: string | null): CoverageInputs => ({
  pr: { id: "pr-9", name: "ENG-142: secure login" },
  issue,
  diff: diff === null ? null : { text: diff, truncated: false },
});

function judge(response: string, issue: IntentIssue | null = ISSUE, diff: string | null = DIFF) {
  return judgeCoverage({ llm: new MockLLMProvider(response) }, inputs(issue, diff));
}

describe("acceptance-criteria extraction", () => {
  it("pulls the list under an Acceptance Criteria heading", () => {
    const { seeds, explicit } = extractAcceptanceCriteria(ISSUE);
    expect(explicit).toBe(true);
    expect(seeds.map((s) => s.text)).toEqual([
      "Email must be verified before a session is created",
      "The session is cleared on logout",
      "Failed login attempts are rate limited",
    ]);
    expect(seeds.every((s) => s.source === "description")).toBe(true);
  });

  it("groups Given/When/Then into scenarios when there is no AC heading", () => {
    const g: IntentIssue = {
      ...ISSUE,
      description:
        "Given a logged-out user\nWhen they submit valid creds\nThen a session is created",
    };
    const { seeds, explicit } = extractAcceptanceCriteria(g);
    expect(explicit).toBe(true);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.text).toMatch(/given .* then a session is created/i);
  });

  it("includes subtasks as units of intent", () => {
    const s: IntentIssue = {
      ...ISSUE,
      description: "no structured criteria here",
      subtasks: [{ key: "ENG-143", summary: "Add audit logging", status: "To Do" }],
    };
    const { seeds } = extractAcceptanceCriteria(s);
    expect(seeds.some((x) => x.source === "subtask" && x.text === "Add audit logging")).toBe(true);
  });

  it("falls back to the DESCRIPTION (explicit=false) when nothing structured is found", () => {
    const bare: IntentIssue = {
      ...ISSUE,
      description: "just some prose about the goal",
      subtasks: [],
      comments: [],
    };
    const { seeds, explicit } = extractAcceptanceCriteria(bare);
    expect(explicit).toBe(false);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.text).toBe("just some prose about the goal"); // description, not summary
  });

  it("pulls intent from a templated description (security-finding Remediation section)", () => {
    const finding: IntentIssue = {
      ...ISSUE,
      summary: "Cookie missing HttpOnly flag",
      description: [
        "Finding Description",
        "Cookies are set without the HttpOnly flag.",
        "Severity",
        "Medium",
        "Remediation Recommendation",
        "Set the HttpOnly attribute on all session cookies.",
        "Steps to Reproduce",
        "NA",
      ].join("\n"),
      subtasks: [],
      comments: [],
    };
    const { seeds, explicit } = extractAcceptanceCriteria(finding);
    expect(explicit).toBe(true);
    const texts = seeds.map((s) => s.text);
    expect(texts.some((t) => /Remediation.*HttpOnly attribute/i.test(t))).toBe(true);
    expect(texts.some((t) => /steps to reproduce/i.test(t))).toBe(false); // "NA" section skipped
  });

  it("prefers named custom fields (intentFields) over description parsing", () => {
    const withField: IntentIssue = {
      ...ISSUE,
      description: "As a user I want a thing.\nAcceptance Criteria:\n- from the description",
      intentFields: [{ label: "Acceptance Criteria", text: "- email verified\n- session cleared" }],
    };
    const { seeds, explicit } = extractAcceptanceCriteria(withField);
    expect(explicit).toBe(true);
    expect(seeds.map((s) => s.text)).toEqual(
      expect.arrayContaining(["email verified", "session cleared"]),
    );
    expect(seeds.some((s) => s.text === "from the description")).toBe(false); // custom field won
  });
});

describe("diff segmentation", () => {
  it("splits a unified diff into stable per-file hunks", () => {
    const hunks = segmentDiff(DIFF);
    expect(hunks.map((h) => h.id)).toEqual(["H1", "H2"]);
    expect(hunks.every((h) => h.file === "src/auth.ts")).toBe(true);
    expect(hunks[0]?.body).toContain("emailVerified");
    expect(hunks[1]?.body).toContain("clearSession");
  });
});

describe("line parsing", () => {
  it("parses the rigid per-criterion format and ignores off-format lines", () => {
    const parsed = parseCoverageLines(
      [
        "[AC1] status=implemented cite=[H1] :: adds the check",
        "prose that should be ignored",
        "[AC2] status=possibly-missing cite=[AC2] :: where is this?",
        "[AC3] status=cannot-tell cite=[] :: too vague",
      ].join("\n"),
    );
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ acId: "AC1", status: "implemented", cites: ["H1"] });
    expect(parsed[1]).toMatchObject({ acId: "AC2", status: "possibly-missing" });
    expect(parsed[2]).toMatchObject({ acId: "AC3", status: "cannot-tell", cites: [] });
  });
});

describe("honest states (short-circuit before the model)", () => {
  it("returns no-intent when the PR has no linked issue", async () => {
    const a = await judge("unused", null);
    expect(a.status).toBe("no-intent");
    expect(a.criteria).toHaveLength(0);
    expect(a.summary).toMatch(/no linked jira issue/i);
  });

  it("returns no-diff when the diff is unavailable", async () => {
    const a = await judge("unused", ISSUE, null);
    expect(a.status).toBe("no-diff");
    expect(a.issue?.key).toBe("ENG-142");
  });
});

describe("assessment + suppression gate", () => {
  const WELL_BEHAVED = [
    "[AC1] status=implemented cite=[H1] :: Adds an emailVerified check before creating the session.",
    "[AC2] status=implemented cite=[H2] :: Clears the session on logout.",
    "[AC3] status=possibly-missing cite=[AC3] :: I don't see rate limiting on failed attempts in this diff - handled elsewhere?",
    "SUMMARY: Verification and logout look addressed; rate limiting isn't visible and is worth a check.",
  ].join("\n");

  it("carries implemented (with hunk citations) and a planted gap (as a cited question)", async () => {
    const a = await judge(WELL_BEHAVED);
    expect(a.status).toBe("assessed");
    const [ac1, ac2, ac3] = a.criteria;
    expect(ac1?.status).toBe("implemented");
    expect(ac1?.citations).toEqual([
      { marker: "H1", kind: "diff-hunk", ref: expect.stringContaining("src/auth.ts") },
    ]);
    expect(ac2?.status).toBe("implemented");
    // The planted gap surfaces as a hedged question anchored to its acceptance criterion.
    expect(ac3?.status).toBe("possibly-missing");
    expect(ac3?.citations[0]).toMatchObject({
      marker: "AC3",
      kind: "acceptance-criterion",
      url: "https://acme.atlassian.net/browse/ENG-142",
    });
    expect(a.summary).toMatch(/2 of 3/);
  });

  it("INVARIANT: every implemented cites a hunk, every possibly-missing cites its criterion", async () => {
    const a = await judge(WELL_BEHAVED);
    for (const c of a.criteria) {
      if (c.status === "implemented")
        expect(c.citations.some((x) => x.kind === "diff-hunk")).toBe(true);
      if (c.status === "possibly-missing")
        expect(c.citations.some((x) => x.kind === "acceptance-criterion")).toBe(true);
    }
  });

  it("downgrades implemented -> cannot-tell when no code location is cited", async () => {
    const a = await judge(
      [
        "[AC1] status=implemented cite=[] :: trust me, it's done",
        "[AC2] status=implemented cite=[H99] :: cites a hunk that doesn't exist",
        "[AC3] status=cannot-tell cite=[] :: thin",
      ].join("\n"),
    );
    expect(a.criteria[0]?.status).toBe("cannot-tell"); // no cite
    expect(a.criteria[0]?.note).toMatch(/no specific code location/i);
    expect(a.criteria[1]?.status).toBe("cannot-tell"); // unknown hunk
    expect(a.criteria.every((c) => c.status !== "implemented" || c.citations.length > 0)).toBe(
      true,
    );
  });

  it("drops an invented acceptance criterion (can't fabricate a gap)", async () => {
    const a = await judge(
      [
        "[AC1] status=implemented cite=[H1] :: ok",
        "[AC99] status=possibly-missing cite=[AC99] :: this criterion was never in the ticket",
      ].join("\n"),
    );
    expect(a.criteria.map((c) => c.id)).toEqual(["AC1", "AC2", "AC3"]); // no AC99
    // AC2/AC3, unaddressed by the model, stay cannot-tell - never silently "implemented".
    expect(a.criteria[1]?.status).toBe("cannot-tell");
    expect(a.criteria[2]?.status).toBe("cannot-tell");
  });

  it("does NOT flag a correctly-implemented PR (escaped false-positive: 0)", async () => {
    const a = await judge(
      [
        "[AC1] status=implemented cite=[H1] :: verified",
        "[AC2] status=implemented cite=[H2] :: cleared",
        // A well-behaved judge on a fully-covered ticket wouldn't reach AC3; simulate all-covered:
        "[AC3] status=implemented cite=[H1][H2] :: rate limiting added alongside",
      ].join("\n"),
    );
    expect(a.criteria.some((c) => c.status === "possibly-missing")).toBe(false);
  });

  it("flags the no-explicit-AC caveat when assessing against the description only", async () => {
    const bare: IntentIssue = {
      ...ISSUE,
      description: "just prose, no criteria",
      subtasks: [],
      comments: [],
    };
    const a = await judge("[AC1] status=implemented cite=[H1] :: does the thing", bare);
    expect(a.caveats.some((c) => /no explicit acceptance criteria/i.test(c))).toBe(true);
  });
});
