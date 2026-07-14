import type { ReactNode } from "react";
import { headers } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata = {
  title: "Atlas",
  description: "AI-powered Engineering Intelligence Platform",
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
