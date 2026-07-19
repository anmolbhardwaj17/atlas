/**
 * Renders an Atlas answer as a Discord interaction response. Same contract as the Slack formatter:
 * a grounded answer becomes a rich embed (text + confidence footer + citation deep-links); an
 * ungrounded one becomes a plain honest-absence message with NO embed (never a fabricated answer,
 * P4/US-11). Transport-agnostic — the same payload works whether interactions arrive over HTTP or
 * the gateway.
 *
 * Discord markdown natively supports `**bold**`, `*italic*`, `` `code` ``, and — inside embeds —
 * masked links `[text](url)`, so the only cleanup needed is stripping the citation markers ([N1]),
 * which have no provenance panel to bind to in chat.
 */

export interface DiscordAnswerInput {
  grounded: boolean;
  /** Grounded → the answer; ungrounded → the honest-absence reason. */
  text: string;
  confidence?: string | null;
  citations?: Array<{ number: number; provenanceUrl: string; kind: string }>;
}

export interface DiscordEmbed {
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
}

/** The `data` of a Discord interaction response (type 4 / a deferred followup PATCH). */
export interface DiscordMessage {
  content?: string;
  embeds?: DiscordEmbed[];
}

const DESCRIPTION_LIMIT = 4000; // Discord embed description hard-limit is 4096; leave headroom.
const FIELD_LIMIT = 1024;
const BRAND_GREEN = 0x3ba776;

const CONFIDENCE_LABEL: Record<string, string> = {
  observed: "Observed",
  "inferred-high": "Inferred (high)",
  "inferred-low": "Inferred (low)",
  advisory: "Advisory",
  insufficient: "Insufficient data",
};

/** Strip citation markers ([N1]/[A2]) — Discord keeps **bold** and masked links as-is. */
export function toDiscordMarkdown(md: string): string {
  return md.replace(/\s*\[[NEA]\d+\]/g, "").trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function absolute(url: string, appBaseUrl: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${appBaseUrl.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

export function formatAnswerMessage(input: DiscordAnswerInput, appBaseUrl: string): DiscordMessage {
  if (!input.grounded) {
    // Honest absence — the refusal IS the answer. Plain content, no embed dressing.
    return {
      content: truncate(
        toDiscordMarkdown(input.text) || "I don't have that in the synced graph.",
        1900,
      ),
    };
  }

  const embed: DiscordEmbed = {
    description: truncate(toDiscordMarkdown(input.text), DESCRIPTION_LIMIT),
    color: BRAND_GREEN,
  };

  const cites = input.citations ?? [];
  if (cites.length > 0) {
    const value = cites
      .slice(0, 10)
      .map((c) => `[${c.number}](${absolute(c.provenanceUrl, appBaseUrl)})`)
      .join("  ");
    embed.fields = [{ name: "Sources", value: truncate(value, FIELD_LIMIT) }];
  }
  if (input.confidence) {
    embed.footer = {
      text: `Confidence: ${CONFIDENCE_LABEL[input.confidence] ?? input.confidence}`,
    };
  }

  return { embeds: [embed] };
}
