import type { ReactNode } from "react";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script mutates <html>'s class before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
