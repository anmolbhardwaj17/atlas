import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Crawl rules.
 *
 * AI crawlers are allowed on purpose. The public pages are marketing — being quoted accurately by
 * an assistant when someone asks "what is Atlas" is worth more than the traffic a block would
 * preserve, and a model that can't read the site will answer from guesswork instead. GPTBot,
 * ClaudeBot, PerplexityBot and friends are all covered by the default `*` rule; they're listed
 * explicitly anyway so the intent is legible to whoever reads this next and doesn't have to be
 * inferred from an absence.
 *
 * Everything behind auth is disallowed. Those routes redirect to /login for anyone without a
 * session, so a crawler would only ever index the login page under a dozen different URLs — and
 * `/auth/` must never be crawled at all, since callback URLs carry one-time codes.
 */
const PRIVATE = [
  "/dashboard",
  "/explore",
  "/map",
  "/ask",
  "/insights",
  "/war-room",
  "/compliance",
  "/integrations",
  "/settings",
  "/sift",
  "/create-org",
  "/invite/",
  "/auth/",
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      // Named explicitly so the decision to welcome them is on the record, not implied.
      {
        userAgent: [
          "GPTBot",
          "ClaudeBot",
          "Claude-Web",
          "PerplexityBot",
          "Google-Extended",
          "Applebot-Extended",
          "CCBot",
        ],
        allow: "/",
        disallow: PRIVATE,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
