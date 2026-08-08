import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { AtlasLogo } from "@/components/brand";

export const metadata: Metadata = {
  title: "Page not found",
  // A 404 that gets indexed is a 404 that shows up in search results.
  robots: { index: false, follow: false },
};

/**
 * 404.
 *
 * Atlas is a graph product, so the honest metaphor was sitting right there: a URL that doesn't
 * resolve is a node with no edges into it. The page draws exactly that — a real map card in the
 * product's own notation, with a dashed edge (the graph's "inferred, unproven" line) trailing off
 * to nothing. It reads as the product being self-aware rather than as a stock error page, and it
 * costs one small SVG.
 *
 * Deliberately not funny. A visitor here is already mildly annoyed; a joke asks them to admire the
 * writing instead of getting them where they were going. Two exits, no cleverness.
 *
 * Light-pinned like the other public pages (see `.theme-light`): this renders outside the
 * authenticated shell, where the theme toggle doesn't exist.
 */
export default function NotFound() {
  return (
    <div className="theme-light flex min-h-dvh flex-col bg-white text-neutral-900">
      <header className="border-b border-neutral-200/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <AtlasLogo size={28} spin className="size-7" />
            <span className="text-lg font-semibold tracking-tight">Atlas</span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="w-full max-w-lg text-center">
          {/* The graph's own notation: a node, and an edge that leads nowhere. Same dotted canvas
              and dashed-edge language the map uses, so this looks like part of the product. */}
          <div
            className="relative mx-auto flex h-40 w-full max-w-sm items-center justify-center rounded-2xl border border-neutral-200"
            style={{
              backgroundImage:
                "radial-gradient(hsl(var(--muted-foreground) / 0.16) 1.3px, transparent 1.3px)",
              backgroundSize: "16px 16px",
            }}
          >
            <svg viewBox="0 0 260 80" className="h-20 w-64" aria-hidden="true">
              <line
                x1="0"
                y1="40"
                x2="96"
                y2="40"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="5 4"
                className="text-neutral-300"
              />
              <rect
                x="100"
                y="22"
                width="112"
                height="36"
                rx="9"
                fill="white"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                className="text-neutral-300"
              />
              <text
                x="156"
                y="45"
                textAnchor="middle"
                className="fill-neutral-400 font-medium"
                fontSize="12"
              >
                not found
              </text>
            </svg>
          </div>

          <p className="mt-10 text-xs font-medium uppercase tracking-widest text-neutral-400">
            404
          </p>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            No route to this page.
          </h1>
          <p className="mx-auto mt-5 max-w-sm text-balance leading-relaxed text-neutral-600">
            Nothing in the graph points here. The link may be out of date, or the page may have
            moved somewhere Atlas can still reach.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-11 px-7">
              <Link href="/">Back to the front page</Link>
            </Button>
            <Button asChild variant="ghost" className="text-neutral-600 hover:text-neutral-900">
              <Link href="/dashboard">Go to your dashboard</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
