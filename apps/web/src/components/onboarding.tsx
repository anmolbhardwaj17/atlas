"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Waypoints,
  Lightbulb,
  ShieldCheck,
  Activity,
  MessagesSquare,
  Bell,
  Sparkles,
  Loader2,
  Lock,
  BadgeCheck,
  RefreshCw,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROVIDERS, ProviderLogo } from "@/components/integrations/providers";
import { seedDemo } from "@/lib/browser-api";

/**
 * Onboarding / first-run empty state (P1.2, docs/09 §8). The graph is empty, so this is the org's
 * front door — and its pitch: it portrays what Atlas *is* today (a live map, security & vulnerability
 * intel, operational answers, cited AI, alerts) before giving a simple two-path get-started flow:
 *   1. **Load sample data** — one click seeds the "Shopyard" estate through the real ingest +
 *      inference pipeline, so the user is exploring a cited graph in seconds (TTFI, NFR-22). No creds.
 *   2. **Connect a real source** — AWS / GitHub / Bitbucket / Azure / GCP read-only setup, shared
 *      with the Integrations hub (docs/13 §4-5).
 *
 * Mono B&W design language (the only hue is the AI/status accent), shadcn primitives, theme-aware.
 */

interface Capability {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** What a new org unlocks — kept in sync with what's actually shipped so the front door never
 *  undersells the product. */
const CAPABILITIES: Capability[] = [
  {
    icon: Waypoints,
    title: "Live infrastructure map",
    body: "Your cloud and code, wired together in one canvas you can trace end to end.",
  },
  {
    icon: Lightbulb,
    title: "Insights & posture",
    body: "Prioritized findings across the Well-Architected pillars — not a wall of alerts.",
  },
  {
    icon: ShieldCheck,
    title: "Security & vulnerabilities",
    body: "Known CVEs in your dependencies, ranked by real blast radius across repos.",
  },
  {
    icon: Activity,
    title: "Operational intelligence",
    body: "See what's broken right now — with an AI root-cause, down to the PR.",
  },
  {
    icon: MessagesSquare,
    title: "Ask Atlas",
    body: "Cited, confidence-tiered answers over your own graph — never a guess.",
  },
  {
    icon: Bell,
    title: "Proactive alerts",
    body: "A heads-up in Slack, Discord, or Teams the moment something changes.",
  },
];

const TRUST: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Lock, label: "Read-only by construction" },
  { icon: BadgeCheck, label: "Every claim cited" },
  { icon: RefreshCw, label: "Continuously updated" },
];

export function Onboarding({ orgId, canSeed }: { orgId: string; canSeed: boolean }) {
  return (
    <div className="relative isolate -m-4 overflow-hidden px-4 py-10 md:-m-6 md:px-6 md:py-14">
      <GraphBackdrop />
      {/* TODO: the big liquid-metal-shader Atlas mark goes here — top-right, bleeding a little off
          the edge. The layout is left-aligned to leave it room. */}

      <div className="max-w-4xl space-y-12 duration-700 animate-in fade-in slide-in-from-bottom-2">
        {/* ── Hero (left-aligned) ── */}
        <header className="space-y-5">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Welcome to Atlas
            </p>
            <h1 className="text-pretty text-3xl font-semibold tracking-tight md:text-4xl">
              Build your knowledge graph
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
              Atlas turns your cloud and code into one live, cited graph — map it, surface the
              risks, ask it anything, and get alerted the moment something breaks. Start exploring
              in one click, or connect a real source.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
            {TRUST.map((t) => (
              <span
                key={t.label}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <t.icon className="size-3.5" /> {t.label}
              </span>
            ))}
          </div>
        </header>

        {/* ── What you'll get ── */}
        <section className="space-y-4">
          <SectionLabel>What you'll get</SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div
                key={c.title}
                className="group rounded-xl border border-border bg-card/40 p-4 transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-card hover:shadow-sm"
              >
                <div className="grid size-9 place-items-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
                  <c.icon className="size-[18px]" />
                </div>
                <p className="mt-3 text-sm font-medium">{c.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Get started ── real source first (the destination), sample data as the instant try ── */}
        <section className="space-y-4">
          <SectionLabel>Get started</SectionLabel>
          <ConnectSource />

          <div className="flex items-center gap-3 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or explore sample data first
            <span className="h-px flex-1 bg-border" />
          </div>
          <SampleDataCard orgId={orgId} canSeed={canSeed} />
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
      setError(e instanceof Error ? e.message : "Something went wrong.");
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

/** A provider picker — each tile jumps to the Integrations page with that provider's guided setup
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
