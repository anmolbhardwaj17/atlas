import { describe, expect, it } from "vitest";
import { issueNode, issueEdges } from "./issue";
import { withContext } from "./context";
import { adfToText } from "../adf";

const CTX = { site: "acme" };

const adf = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const ISSUE = withContext(
  {
    key: "ENG-142",
    fields: {
      summary: "Verify email before checkout",
      description: adf("AC1: block checkout unless the email is verified. AC2: show a banner."),
      status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
      issuetype: { name: "Story", subtask: false },
      project: { key: "ENG" },
      parent: undefined,
      labels: ["checkout", "auth"],
      assignee: { displayName: "Priya" },
      reporter: { displayName: "Sam" },
      created: "2026-07-01T10:00:00.000Z",
      updated: "2026-07-10T10:00:00.000Z",
      subtasks: [
        { key: "ENG-143", fields: { summary: "Add verification check", status: { name: "Done" } } },
      ],
      comment: {
        comments: [
          {
            author: { displayName: "Sam" },
            body: adf("Also handle the resend case"),
            created: "2026-07-02",
          },
        ],
      },
    },
  },
  CTX,
);

describe("jira issueNode", () => {
  it("captures intent: summary, description text, labels, subtasks, comments", () => {
    const n = issueNode(ISSUE);
    expect(n.urn).toBe("jira:acme:issue/ENG-142");
    expect(n.kind).toBe("jira.issue");
    expect(n.displayName).toBe("ENG-142 — Verify email before checkout");
    const a = n.attributes as Record<string, unknown>;
    expect(a.description).toContain("block checkout unless the email is verified");
    expect(a.labels).toEqual(["checkout", "auth"]);
    expect(a.status).toBe("In Progress");
    expect(a.issueType).toBe("Story");
    expect((a.subtasks as unknown[]).length).toBe(1);
    expect((a.comments as Array<{ text: string }>)[0]?.text).toContain("resend");
    expect(a.url).toBe("https://acme.atlassian.net/browse/ENG-142");
  });

  it("emits project CONTAINS issue", () => {
    const edges = issueEdges(ISSUE);
    expect(edges).toContainEqual({
      type: "CONTAINS",
      fromUrn: "jira:acme:project/ENG",
      toUrn: "jira:acme:issue/ENG-142",
      origin: "observed",
    });
  });
});

describe("adfToText", () => {
  it("flattens ADF text nodes and renders list items with a bullet", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Intro." }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "text", text: "one" }] },
            { type: "listItem", content: [{ type: "text", text: "two" }] },
          ],
        },
      ],
    };
    const t = adfToText(doc);
    expect(t).toContain("Intro.");
    expect(t).toContain("• one");
    expect(t).toContain("• two");
  });
  it("passes through a plain string and tolerates junk", () => {
    expect(adfToText("hello")).toBe("hello");
    expect(adfToText(null)).toBe("");
  });
});
