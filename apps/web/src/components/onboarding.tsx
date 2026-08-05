"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ArrowRight } from "lucide-react";
import { LiquidAtlasMark } from "@/components/liquid-atlas-mark";
import { Button } from "@/components/ui/button";
import { PROVIDERS, ProviderLogo } from "@/components/integrations/providers";
import { ConnectIllustration } from "@/components/onboarding/illustrations/connect-illustration";
import { MapIllustration } from "@/components/onboarding/illustrations/map-illustration";
import { AskIllustration } from "@/components/onboarding/illustrations/ask-illustration";
import { seedDemo } from "@/lib/browser-api";

/**
 * Onboarding / first-run empty state (P1.2, docs/09 §8). A new org has already chosen Atlas, so this
 * screen's ONE job is the fastest path from empty → first value: connect a real source (the real
 * payoff) or load sample data (instant). Deliberately lean and action-first — the marketing-style
 * "what you’ll get" capability carousel now lives in `./onboarding/capability-marquee` (ready for a
 * landing page) and is intentionally NOT rendered here.
 */

/** The three beats after "get started", each with a little illustration in our house style, so a new
 *  user knows what to expect — that it's read-only, roughly how long the first sync takes, and what
 *  they get at the end — instead of staring at an empty dashboard. */
const STEPS: Array<{ title: string; body: string; Illustration: React.ComponentType }> = [
  {
    title: "Connect",
    body: "Read-only access — Atlas can never change your cloud or code.",
    Illustration: ConnectIllustration,
  },
  {
    title: "Atlas builds your graph",
    body: "Your estate is crawled and wired together — usually just a few minutes.",
    Illustration: MapIllustration,
  },
  {
    title: "Explore & ask",
    body: "Map it, see the risks, ask anything, and get alerted when it changes.",
    Illustration: AskIllustration,
  },
];

export function Onboarding({
  orgId,
  canSeed,
  name,
}: {
  orgId: string;
  canSeed: boolean;
  name?: string | null | undefined;
}) {
  const firstName = name?.trim().split(/\s+/)[0] ?? null;
  return (
    <div className="relative isolate overflow-hidden py-2">
      <GraphBackdrop />

      {/* Big liquid-metal Atlas mark, bleeding off the top-right corner (the left-aligned content
          leaves this space open). Decorative; clipped by the section's overflow-hidden. */}
      <div className="pointer-events-none absolute -right-32 -top-36 z-0 hidden md:block">
        <div className="relative">
          <div className="absolute inset-16 rounded-full bg-foreground/5 blur-3xl" />
          <LiquidAtlasMark size={440} />
        </div>
      </div>

      <div className="relative z-10 max-w-3xl space-y-10 duration-700 animate-in fade-in slide-in-from-bottom-2">
        {/* Hero — short + personal; they already chose Atlas, so no re-pitch. */}
        <header className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Welcome to Atlas
          </p>
          <h1 className="text-pretty text-3xl font-semibold tracking-tight md:text-4xl">
            {firstName
              ? `Let's build your graph, ${firstName}`
              : "Let’s build your knowledge graph"}
          </h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
            Connect a source and Atlas turns your cloud and code into one live, cited graph you can
            explore, search, and ask — or explore a sample estate first.
          </p>
        </header>

        {/* Get started — the whole point of the screen, front and centre. */}
        <section className="space-y-4">
          <SectionLabel>Get started</SectionLabel>
          <ConnectSource />
          <div className="flex items-center gap-3 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or explore a sample estate first
            <span className="h-px flex-1 bg-border" />
          </div>
          <SampleDataCard orgId={orgId} canSeed={canSeed} />
        </section>

        {/* What happens next — expectation-setting (illustrated) so a slow first sync never feels
            broken: connect (read-only) → Atlas builds the graph → explore & ask. */}
        <section className="space-y-4">
          <SectionLabel>What happens next</SectionLabel>
          <ol className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="overflow-hidden rounded-2xl border border-border bg-card/40"
              >
                <div className="p-2.5">
                  <div className="relative aspect-[2/1] overflow-hidden rounded-xl bg-muted/20">
                    <s.Illustration />
                  </div>
                </div>
                <div className="px-4 pb-4 pt-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Step {i + 1}
                  </span>
                  <p className="mt-1 text-sm font-medium">{s.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </h2>
  );
}

/** A faint dotted "graph paper" wash behind the page — evokes the map canvas, fades out at the
 *  edges so it never competes with the content. Purely decorative. */
function GraphBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 opacity-[0.5] dark:opacity-[0.35]"
      style={{
        backgroundImage:
          "radial-gradient(circle at center, hsl(var(--muted-foreground) / 0.25) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
        maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 75%)",
      }}
    />
  );
}

function SampleDataCard({ orgId, canSeed }: { orgId: string; canSeed: boolean }) {
  const router = useRouter();
  const [state, setState] = React.useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setState("loading");
    setError(null);
    try {
      await seedDemo(orgId);
      // The dashboard is a server component - refresh re-renders it with the seeded graph.
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn’t load the sample data. Try again in a moment.",
      );
      setState("error");
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-foreground/15 bg-foreground text-background shadow-sm">
      {/* A soft corner glow so the primary path reads as the recommended one, without adding a hue. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-background/10 blur-2xl"
      />
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="flex items-start gap-4">
          <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-background/15">
            <Sparkles className="size-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold">Load sample data</p>
              <span className="rounded-full bg-background/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                Fastest
              </span>
            </div>
            <p className="mt-1 max-w-md text-sm text-background/70">
              See it working in seconds. Seed a realistic e-commerce estate — services, databases,
              repos, deploys — built through the real ingest &amp; inference pipeline. No
              credentials needed.
            </p>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="shrink-0">
          {canSeed ? (
            <Button
              onClick={() => void load()}
              disabled={state === "loading"}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              {state === "loading" ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Building graph…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Load sample data
                </>
              )}
            </Button>
          ) : (
            <p className="max-w-[12rem] text-xs text-background/70 sm:text-right">
              Ask an organization admin to load sample data.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Sourced from the real integration catalog so this never drifts from what Integrations offers.
// Short brand labels for the compact tiles (the catalog carries the full legal names).
const SHORT_LABEL: Record<string, string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",
  github: "GitHub",
  bitbucket: "Bitbucket",
  jenkins: "Jenkins",
};
/** The sources you can connect right now (available graph sources — not the outbound alert
 *  channels, which are set up from Integrations/Settings). Everything else (coming-soon +
 *  observability + alerts) lives behind the "more" tile so the breadth is discoverable. */
const CONNECTABLE = PROVIDERS.filter((p) => p.status === "available" && p.category !== "Alerts");
const MORE_COUNT = PROVIDERS.length - CONNECTABLE.length;
// A few logos to peek on the "more" tile so it reads as "lots more", not just a link.
const MORE_PREVIEW = ["gitlab", "datadog", "slack"]
  .map((id) => PROVIDERS.find((p) => p.id === id))
  .filter((p): p is (typeof PROVIDERS)[number] => Boolean(p));

/** A provider picker — each tile jumps to the Integrations page with that provider’s guided setup
 *  already open (`?connect=<id>`). A final "more" tile opens the full catalog, so a new user sees
 *  that Atlas connects far more than the handful shown here. */
function ConnectSource() {
  const router = useRouter();
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {CONNECTABLE.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => router.push(`/integrations?connect=${p.id}`)}
            className="group flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ProviderLogo provider={p} className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {SHORT_LABEL[p.id] ?? p.name}
            </span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
        {/* Full-catalog tile — dashed to read as "more", with a few logos peeking. */}
        <button
          type="button"
          onClick={() => router.push("/integrations")}
          className="group flex items-center gap-2.5 rounded-xl border border-dashed border-border bg-background px-3 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex -space-x-1.5">
            {MORE_PREVIEW.map((p) => (
              <span
                key={p.id}
                className="grid size-5 place-items-center rounded-full bg-muted ring-2 ring-background"
              >
                <ProviderLogo provider={p} className="size-3" />
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">+{MORE_COUNT} more</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Cloud, code, CI/CD, observability, and alerts — pick one to open its guided setup, or browse
        the full catalog on <span className="font-medium text-foreground">Integrations</span>.
        Read-only access, always.
      </p>
    </div>
  );
}
