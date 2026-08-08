/**
 * One source of truth for everything that describes Atlas to something that isn't a person:
 * link previews, search engines, AI crawlers, the web manifest.
 *
 * `NEXT_PUBLIC_SITE_URL` is a build arg like the other NEXT_PUBLIC_* values, because absolute URLs
 * have to be baked into the HTML — a share card can't resolve `/og.png`, and a crawler indexing a
 * relative canonical would attribute the page to whatever host it happened to fetch from. The
 * fallback is the current production host so a build without the arg still emits correct links
 * rather than silently emitting broken ones.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://atlas-web.fly.dev").replace(
  /\/$/,
  "",
);

export const SITE_NAME = "Atlas";

/** The one-line answer to "what is this", used as the meta description and the card subtitle. */
export const SITE_TAGLINE = "Stop guessing how your system fits together";

/**
 * Deliberately concrete rather than keyword soup. This string is what someone sees under the link
 * in a search result or a Slack unfurl, and increasingly it's what an LLM quotes when asked what
 * Atlas is — so it states what the product does and the one thing that makes it different, in
 * plain sentences a model can lift verbatim without mangling.
 */
export const SITE_DESCRIPTION =
  "Atlas connects to your cloud accounts, repositories, pipelines and issue tracker with read-only access, and builds one live map of everything you run and ship. Trace an incident back to the deploy and pull request that caused it, see what breaks before you change something, and ask questions in plain language — with a citation on every answer.";
