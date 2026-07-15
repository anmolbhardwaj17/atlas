/**
 * Renders an Atlas answer as Slack Block Kit. The answer engine's contract is preserved end-to-end:
 * a grounded answer shows its text + confidence + citation deep-links back into Atlas; an ungrounded
 * one shows the honest-absence message and NOTHING else (never a fabricated answer, P4/US-11).
 *
 * Pure + provider-free (a minimal local input shape, not the full `Answer` type) so it unit-tests
 * without booting the AI package. `toSlackMrkdwn` does a light Markdown→Slack-mrkdwn pass: Slack uses
 * *single-star* bold and `<url|text>` links, and citation markers ([N1]/[A2]) have no provenance
 * panel to bind to in a chat message, so they're stripped in favour of the Sources footer.
 */

export interface SlackAnswerInput {
  grounded: boolean;
  /** Grounded → the answer; ungrounded → the honest-absence reason (the engine puts it here too). */
  text: string;
  confidence?: string | null;
  citations?: Array<{ number: number; provenanceUrl: string; kind: string }>;
}

/** Slack Block Kit blocks are loosely typed at the boundary; the SDK/HTTP payload validates shape. */
export type SlackBlock = Record<string, unknown>;

const SECTION_LIMIT = 2900; // Slack section text hard-limit is 3000; leave headroom.

/** Light Markdown → Slack mrkdwn: strip citation markers, `**b**`→`*b*`, `[t](u)`→`<u|t>`. */
export function toSlackMrkdwn(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>") // links first (before marker strip)
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // bold
    .replace(/\s*\[[NEA]\d+\]/g, "") // citation markers — no panel to bind to here
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Prefix a relative provenance path with the app base URL; pass absolute URLs through. */
function absolute(url: string, appBaseUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${appBaseUrl.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  observed: "Observed",
  "inferred-high": "Inferred (high)",
  "inferred-low": "Inferred (low)",
  advisory: "Advisory",
  insufficient: "Insufficient data",
};

export function formatAnswerBlocks(
  input: SlackAnswerInput,
  question: string,
  appBaseUrl: string,
): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  // Echo the question quietly so a channel reader has context for the answer.
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `:mag: *${truncate(question.trim(), 140)}*` }],
  });

  if (!input.grounded) {
    // Honest absence — the refusal IS the answer. No citations, no confidence dressing.
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(
          toSlackMrkdwn(input.text) || "I don't have that in the synced graph.",
          SECTION_LIMIT,
        ),
      },
    });
    return blocks;
  }

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: truncate(toSlackMrkdwn(input.text), SECTION_LIMIT) },
  });

  // Footer: confidence + citation deep-links (numbered, so they line up with the answer's claims).
  const footer: string[] = [];
  if (input.confidence) {
    footer.push(`Confidence: ${CONFIDENCE_LABEL[input.confidence] ?? input.confidence}`);
  }
  const cites = input.citations ?? [];
  if (cites.length > 0) {
    const links = cites
      .slice(0, 10)
      .map((c) => `<${absolute(c.provenanceUrl, appBaseUrl)}|[${c.number}]>`)
      .join(" ");
    footer.push(`Sources: ${links}`);
  }
  if (footer.length > 0) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: footer.join("  ·  ") }] });
  }

  return blocks;
}
