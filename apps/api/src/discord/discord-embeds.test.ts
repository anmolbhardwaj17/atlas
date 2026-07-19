import { describe, it, expect } from "vitest";
import { formatAnswerMessage, toDiscordMarkdown, type DiscordMessage } from "./discord-embeds";

const APP = "https://app.atlas.dev";

describe("toDiscordMarkdown", () => {
  it("strips citation markers but keeps native markdown (bold, masked links)", () => {
    expect(toDiscordMarkdown("**orders-db** is a [Postgres](https://x/db) instance [N1].")).toBe(
      "**orders-db** is a [Postgres](https://x/db) instance.",
    );
  });
});

describe("formatAnswerMessage", () => {
  it("a grounded answer becomes an embed with description, numbered source links, and confidence", () => {
    const msg: DiscordMessage = formatAnswerMessage(
      {
        grounded: true,
        text: "**orders-db** has 3 dependents [N1].",
        confidence: "observed",
        citations: [
          { number: 1, provenanceUrl: "/explore/n-1", kind: "node" },
          { number: 2, provenanceUrl: "https://app.atlas.dev/explore/n-2", kind: "node" },
        ],
      },
      APP,
    );
    expect(msg.content).toBeUndefined();
    const embed = msg.embeds?.[0];
    expect(embed?.description).toContain("**orders-db** has 3 dependents"); // marker stripped, bold kept
    expect(embed?.description).not.toContain("[N1]");
    // Relative provenance absolutized; absolute passed through.
    expect(embed?.fields?.[0]?.value).toContain("[1](https://app.atlas.dev/explore/n-1)");
    expect(embed?.fields?.[0]?.value).toContain("[2](https://app.atlas.dev/explore/n-2)");
    expect(embed?.footer?.text).toBe("Confidence: Observed");
  });

  it("an ungrounded answer is plain content with NO embed (no citations, no confidence)", () => {
    const msg = formatAnswerMessage(
      {
        grounded: false,
        text: 'I couldn\'t find "paymentz-db" in the synced graph.',
        confidence: "insufficient",
        citations: [],
      },
      APP,
    );
    expect(msg.embeds).toBeUndefined();
    expect(msg.content).toContain("couldn't find");
  });

  it("truncates an over-long answer under Discord's embed description limit", () => {
    const msg = formatAnswerMessage(
      { grounded: true, text: "x".repeat(9000), confidence: "observed", citations: [] },
      APP,
    );
    const desc = msg.embeds?.[0]?.description ?? "";
    expect(desc.length).toBeLessThanOrEqual(4000);
    expect(desc.endsWith("…")).toBe(true);
  });

  it("omits the Sources field when there are no citations", () => {
    const msg = formatAnswerMessage(
      { grounded: true, text: "All clear.", confidence: "observed", citations: [] },
      APP,
    );
    expect(msg.embeds?.[0]?.fields).toBeUndefined();
  });
});
