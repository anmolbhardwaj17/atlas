import { describe, it, expect } from "vitest";
import { formatAnswerBlocks, toSlackMrkdwn, type SlackBlock } from "./slack-blocks";

const APP = "https://app.atlas.dev";

/** Collect all mrkdwn text across section + context blocks, for content assertions. */
function allText(blocks: SlackBlock[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    const text = b.text as { text?: string } | undefined;
    if (text?.text) out.push(text.text);
    const els = b.elements as Array<{ text?: string }> | undefined;
    if (els) for (const e of els) if (e.text) out.push(e.text);
  }
  return out.join("\n");
}

describe("toSlackMrkdwn", () => {
  it("converts **bold** to *bold* and [t](u) to <u|t>", () => {
    expect(toSlackMrkdwn("**orders-db** is a [Postgres](https://x/db) instance")).toBe(
      "*orders-db* is a <https://x/db|Postgres> instance",
    );
  });

  it("strips citation markers (no provenance panel in chat)", () => {
    expect(toSlackMrkdwn("Three services depend on it [N1] [A2].")).toBe(
      "Three services depend on it.",
    );
  });
});

describe("formatAnswerBlocks", () => {
  it("a grounded answer renders text + confidence + numbered source deep-links", () => {
    const blocks = formatAnswerBlocks(
      {
        grounded: true,
        text: "**orders-db** has 3 dependents [N1].",
        confidence: "observed",
        citations: [
          { number: 1, provenanceUrl: "/explore/n-123", kind: "node" },
          { number: 2, provenanceUrl: "https://app.atlas.dev/explore/n-456", kind: "node" },
        ],
      },
      "what depends on orders-db?",
      APP,
    );
    const text = allText(blocks);
    expect(text).toContain("*orders-db* has 3 dependents"); // converted + marker stripped
    expect(text).not.toContain("[N1]");
    expect(text).toContain("Confidence: Observed");
    // Relative provenance is absolutized; absolute is passed through.
    expect(text).toContain("<https://app.atlas.dev/explore/n-123|[1]>");
    expect(text).toContain("<https://app.atlas.dev/explore/n-456|[2]>");
    // The question is echoed for channel context.
    expect(text).toContain("what depends on orders-db?");
  });

  it("an ungrounded answer shows ONLY the honest-absence message — no citations, no confidence", () => {
    const blocks = formatAnswerBlocks(
      {
        grounded: false,
        text: 'I couldn\'t find "paymentz-db" in the synced graph.',
        confidence: "insufficient",
        citations: [],
      },
      "what depends on paymentz-db?",
      APP,
    );
    const text = allText(blocks);
    expect(text).toContain("couldn't find");
    expect(text).not.toContain("Confidence:");
    expect(text).not.toContain("Sources:");
  });

  it("truncates an over-long answer instead of exceeding Slack's section limit", () => {
    const blocks = formatAnswerBlocks(
      { grounded: true, text: "x".repeat(5000), confidence: "observed", citations: [] },
      "big",
      APP,
    );
    const section = blocks.find((b) => b.type === "section") as { text: { text: string } };
    expect(section.text.text.length).toBeLessThanOrEqual(2900);
    expect(section.text.text.endsWith("…")).toBe(true);
  });
});
