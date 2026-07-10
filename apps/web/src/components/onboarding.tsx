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
import { AtlasLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { CloudIcon } from "@/components/cloud-icon";
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

      <div className="mx-auto max-w-4xl space-y-12 duration-700 animate-in fade-in slide-in-from-bottom-2">
        {/* ── Hero ── */}
        <header className="space-y-5 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-border bg-background shadow-sm">
            <AtlasLogo size={30} spin className="size-[30px] dark:invert" />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Welcome to Atlas
            </p>
            <h1 className="text-pretty text-3xl font-semibold tracking-tight md:text-4xl">
              Build your knowledge graph
            </h1>
            <p className="mx-auto max-w-2xl text-balance text-sm leading-relaxed text-muted-foreground md:text-base">
              Atlas turns your cloud and code into one live, cited graph — map it, surface the
              risks, ask it anything, and get alerted the moment something breaks. Start exploring
              in one click, or connect a real source.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-1">
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

        {/* ── Get started ── */}
        <section className="space-y-4">
          <SectionLabel>Get started</SectionLabel>
          <SampleDataCard orgId={orgId} canSeed={canSeed} />

          <div className="flex items-center gap-3 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or connect a real source
            <span className="h-px flex-1 bg-border" />
          </div>
          <ConnectSource />
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

const PROVIDERS: Array<{ value: string; label: string; icon: string }> = [
  { value: "aws", label: "AWS", icon: "aws" },
  { value: "github", label: "GitHub", icon: "github-icon" },
  { value: "bitbucket", label: "Bitbucket", icon: "bitbucket" },
  { value: "azure", label: "Azure", icon: "microsoft-azure" },
  { value: "gcp", label: "GCP", icon: "google-cloud" },
];

/** A provider picker — each tile jumps to the Integrations page with that provider's guided setup
 *  already open (`?connect=<id>`). The onboarding no longer shows setup steps inline (there was no
 *  way to actually *connect* from here), so this is the real "get started" hand-off. */
function ConnectSource() {
  const router = useRouter();
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {PROVIDERS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => router.push(`/integrations?connect=${p.value}`)}
            className="group flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CloudIcon name={p.icon} className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.label}</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Choose a source — we&apos;ll open its guided setup on the{" "}
        <span className="font-medium text-foreground">Integrations</span> page. Read-only access,
        always.
      </p>
    </div>
  );
}
