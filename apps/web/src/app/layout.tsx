import type { ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { SITE_URL, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from "@/lib/site";

/**
 * Site-wide metadata. `metadataBase` is what lets every relative asset below resolve to an absolute
 * URL — without it Next emits `/og.png`, which every unfurler (WhatsApp, Slack, iMessage, X) drops
 * on the floor because it has no origin to resolve against.
 *
 * `title.template` gives inner pages "Explore · Atlas" without each one repeating the brand.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} - ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "engineering intelligence",
    "infrastructure map",
    "knowledge graph",
    "root cause analysis",
    "blast radius",
    "AWS",
    "cloud visibility",
  ],
  authors: [{ name: SITE_NAME }],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} - ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
    images: [
      // 1200x630 first: it's what Slack, WhatsApp, iMessage and LinkedIn prefer. The square is a
      // fallback for surfaces that crop to 1:1 and would otherwise letterbox the wide one.
      { url: "/og.png", width: 1200, height: 630, alt: `${SITE_NAME} - ${SITE_TAGLINE}` },
      { url: "/og-square.png", width: 1080, height: 1080, alt: `${SITE_NAME} - ${SITE_TAGLINE}` },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} - ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: ["/og.png"],
  },
  icons: { icon: "/icon.png", apple: "/icon.png" },
  alternates: { canonical: "/" },
  // The app itself is private; only the public pages should ever be indexed, and those set their
  // own robots directives. This default keeps signed-in routes out of search results.
  robots: { index: true, follow: true },
};

// Resolve the theme before first paint (no flash of the wrong theme). Reads the saved choice,
// falling back to the OS preference, and stamps the `dark` class on <html>. Kept in sync with
// THEME_KEY in theme-toggle.tsx.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('atlas.theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The CSP nonce set by middleware. Reading a header opts the whole app into dynamic rendering, which
  // is exactly what a per-request nonce needs — a statically-prerendered page can't carry one, so its
  // inline scripts (including THEME_SCRIPT below) would be blocked by the strict script-src. In prod
  // this makes every page nonce-able; in dev the CSP is permissive so an absent nonce is harmless.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: the inline script mutates <html>'s class before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* suppressHydrationWarning: browser extensions inject attributes on <body>
          (e.g. cz-shortcut-listen) which would otherwise trip a hydration warning. */}
      <body suppressHydrationWarning>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
