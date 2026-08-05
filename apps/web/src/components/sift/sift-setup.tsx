"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  Feather,
  Flame,
  Gauge,
  GitBranch,
  type LucideIcon,
  Maximize2,
  Minimize2,
  Scale,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { SiftMark } from "@/components/sift-mark";
import { AtlasLogo } from "@/components/brand";
import { SiftBackdrop, SiftContributionGrid } from "@/components/sift-backdrop";
import { CloudIcon } from "@/components/cloud-icon";
import { Steps, Step } from "@/components/patterns/steps";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { providerMeta } from "@/lib/taxonomy";
import { cn } from "@/lib/cn";

/**
 * Sift setup (/sift). Standalone to Sift — NOT the Integrations hub. Two columns: the guided setup
 * (Sift × Atlas pairing + numbered steps, mirroring the connector-setup theme) on the left, and a
 * two-step config wizard on the right — review settings first, then the repositories to review.
 * Splitting the form across two steps keeps either step short (no page overscroll). The previous
 * "Coming soon" statement is preserved and reachable from a small link at the top. Onboarding isn't
 * wired yet, so the form is the layout only for now.
 */

/** A repository the user can hand to Sift — identity + which host it lives on (for the brand icon). */
export type RepoOption = { id: string; name: string; provider: string | null };

// ── Review-configuration options (captured here; the model/effort/test depth are wired at the
//    backend later). Each carries a short subtitle + a hover tooltip that explains the trade-off. ──
type Choice = { value: string; label: string; desc: string; tip: string; Icon: LucideIcon };

const MODELS: readonly Choice[] = [
  {
    value: "powerful",
    label: "Powerful",
    desc: "Deepest reasoning",
    tip: "The most thorough review — best for critical services and complex diffs. Slower and pricier.",
    Icon: Brain,
  },
  {
    value: "everyday",
    label: "Everyday",
    desc: "Balanced default",
    tip: "Strong review quality at a good price and speed. Recommended for most repositories.",
    Icon: Gauge,
  },
  {
    value: "fast",
    label: "Fast",
    desc: "Quick & light",
    tip: "Lightweight passes for high pull-request volume — catches the obvious issues fast.",
    Icon: Zap,
  },
];

const EFFORTS: readonly Choice[] = [
  {
    value: "low",
    label: "Low",
    desc: "Surface pass",
    tip: "A quick skim that flags only the most obvious issues.",
    Icon: Feather,
  },
  {
    value: "balanced",
    label: "Balanced",
    desc: "Recommended",
    tip: "A thorough review without over-investing effort on every diff.",
    Icon: Scale,
  },
  {
    value: "high",
    label: "High",
    desc: "Deep dive",
    tip: "Sift works hard on every review — maximum depth, higher cost.",
    Icon: Flame,
  },
];

const TEST_DEPTHS: readonly Choice[] = [
  {
    value: "slim",
    label: "Slim",
    desc: "Key gaps only",
    tip: "Sift flags only the highest-impact missing tests, keeping review noise low.",
    Icon: Minimize2,
  },
  {
    value: "full",
    label: "Full",
    desc: "Exhaustive",
    tip: "Sift reviews test coverage across the whole diff and flags every gap it finds.",
    Icon: Maximize2,
  },
];

export function SiftSetup({ repos }: { repos: RepoOption[] }) {
  const [view, setView] = React.useState<"setup" | "soon">("setup");
  const [step, setStep] = React.useState<"config" | "repos">("config");
  const [submitted, setSubmitted] = React.useState(false);
  const [model, setModel] = React.useState("everyday");
  const [effort, setEffort] = React.useState("balanced");
  const [tests, setTests] = React.useState("full");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(repos.map((r) => r.id)),
  );

  const filtered = repos.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  const allSelected = repos.length > 0 && selected.size === repos.length;

  // The step-1 picks, surfaced as a summary on step 2 so the config carries over visibly.
  const summary: Choice[] = [
    MODELS.find((o) => o.value === model),
    EFFORTS.find((o) => o.value === effort),
    TEST_DEPTHS.find((o) => o.value === tests),
  ].filter((o): o is Choice => Boolean(o));

  const toggleRepo = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (): void =>
    setSelected(allSelected ? new Set() : new Set(repos.map((r) => r.id)));

  if (view === "soon") {
    return (
      <div className="relative -mx-4 flex min-h-[calc(100dvh-9rem)] items-center justify-center overflow-hidden md:-mx-6">
        <button
          onClick={() => setView("setup")}
          className="absolute left-4 top-2 z-20 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur transition-colors hover:text-foreground md:left-6"
        >
          <ArrowLeft className="size-3.5" /> Back to setup
        </button>
        <div className="absolute inset-0 animate-in fade-in fill-mode-both duration-1000 ease-out">
          <SiftBackdrop />
        </div>
        <div className="relative z-10 flex max-w-2xl flex-col items-center px-6 text-center">
          <div className="flex items-center gap-3">
            <SiftMark className="size-10" />
            <span className="pl-2 text-xl text-muted-foreground">×</span>
            <AtlasLogo size={44} spin className="size-14 dark:invert" />
          </div>
          <h1 className="mt-8 text-2xl font-semibold tracking-tight text-balance">
            Reviewed by Sift, mapped by Atlas.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground text-pretty">
            Every pull request gets a deep, whole-codebase review — real issues caught before they
            merge, each one tracked across the pipeline it moves through, so nothing slips past your
            team.
          </p>
          <span className="mt-8 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Coming soon
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative -m-4 min-h-[calc(100dvh-3.5rem)] overflow-hidden p-4 md:-m-6 md:p-6">
      {/* Contribution backdrop — anchored to the bottom-left corner and fanning out toward the
          center, masked with a radial gradient (solid at the corner → transparent by ~three-quarters)
          so it reads as a diagonal glow rather than a full band, keeping the copy and form clean. */}
      <SiftContributionGrid
        className="pointer-events-none absolute bottom-0 left-0 h-full w-[60%] opacity-70"
        style={{
          maskImage:
            "radial-gradient(115% 115% at bottom left, #000 0%, #000 22%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(115% 115% at bottom left, #000 0%, #000 22%, transparent 78%)",
        }}
      />

      <div className="relative z-10 animate-in fade-in fill-mode-both duration-500">
        {/* Top: the preserved "Coming soon" link — absolute so it doesn't push the content down. */}
        <button
          onClick={() => setView("soon")}
          className="absolute right-0 top-0 z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <Sparkles className="size-3" /> Coming soon
        </button>

        <div className="grid items-start gap-10 pt-9 lg:grid-cols-2">
          {/* LEFT — the "coming soon" title + subtext, then the guided steps. */}
          <div className="space-y-7">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <SiftMark className="size-9" />
                <span className="pl-1 text-lg text-muted-foreground/70">×</span>
                <AtlasLogo size={40} spin className="size-12 dark:invert" />
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-balance">
                Reviewed by Sift, mapped by Atlas.
              </h1>
              <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground text-pretty">
                Every pull request gets a deep, whole-codebase review — real issues caught before
                they merge, each one tracked across the pipeline it moves through, so nothing slips
                past your team.
              </p>
            </div>
            <Steps>
              <Step title="Configure the review">
                Choose the model, review effort, and test depth that fit your team. Sift adapts how
                hard it looks at every pull request.
              </Step>
              <Step title="Pick your repositories">
                Select which repos Sift reviews — across Bitbucket, GitHub, or GitLab, wherever your
                code lives.
              </Step>
              <Step title="See reviews in context">
                Sift’s findings appear on each pull request and inside the War Room trace, right
                next to the ticket intent Atlas already checks — code correctness and intent
                coverage, together.
              </Step>
            </Steps>
          </div>

          {/* RIGHT — the two-step review-configuration wizard. Card-less to match the open left
              column. */}
          <div className="relative z-10 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Configure Sift</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step === "config"
                    ? "Choose how Sift reviews your code. You can change this later."
                    : "Pick which repositories Sift should review."}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                Step {step === "config" ? "1" : "2"} of 2
              </span>
            </div>

            <TooltipProvider delayDuration={150}>
              {step === "config" ? (
                <form
                  className="space-y-5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setStep("repos");
                  }}
                >
                  <Field label="Model" hint="Which model powers each review.">
                    <ChoiceGroup options={MODELS} value={model} onChange={setModel} cols={3} />
                  </Field>

                  <Field label="Review effort" hint="How hard Sift works on every diff.">
                    <ChoiceGroup options={EFFORTS} value={effort} onChange={setEffort} cols={3} />
                  </Field>

                  <Field label="Test depth" hint="How thoroughly Sift reviews test coverage.">
                    <ChoiceGroup options={TEST_DEPTHS} value={tests} onChange={setTests} cols={2} />
                  </Field>

                  <div className="flex justify-end">
                    <Button type="submit" className="w-1/2 gap-1.5">
                      Continue <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </form>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSubmitted(true);
                  }}
                >
                  {/* Carry the step-1 picks forward — a compact recap that jumps back to edit. */}
                  <button
                    type="button"
                    onClick={() => setStep("config")}
                    className="group flex w-full flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-2 text-left transition-colors hover:border-foreground/25"
                  >
                    {summary.map((o) => (
                      <span
                        key={o.label}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                      >
                        <o.Icon className="size-3 text-success" />
                        {o.label}
                      </span>
                    ))}
                    <span className="ml-auto text-[11px] text-muted-foreground group-hover:text-foreground">
                      Edit
                    </span>
                  </button>

                  {/* Repositories — every repo Atlas knows, host-agnostic; searchable, select-all
                        or pick individually. */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Repositories</span>
                      {repos.length > 0 ? (
                        <button
                          type="button"
                          onClick={toggleAll}
                          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {allSelected ? "Clear all" : "Select all"}
                        </button>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Every repository Atlas has discovered — pick what Sift reviews.
                    </p>

                    {repos.length === 0 ? (
                      <p className="rounded-md border border-border px-3 py-6 text-center text-xs text-muted-foreground">
                        No repositories yet. Connect a code host in Integrations and they&rsquo;ll
                        show up here.
                      </p>
                    ) : (
                      <>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search repositories…"
                            autoComplete="off"
                            className="pl-8"
                          />
                        </div>
                        <div className="max-h-[calc(100dvh-27rem)] min-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
                          {filtered.length === 0 ? (
                            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                              No repositories match “{query}”.
                            </p>
                          ) : (
                            filtered.map((r) => {
                              const on = selected.has(r.id);
                              const logo = providerMeta(r.provider ?? "")?.logo;
                              return (
                                <button
                                  type="button"
                                  key={r.id}
                                  onClick={() => toggleRepo(r.id)}
                                  aria-pressed={on}
                                  className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent"
                                >
                                  <span
                                    className={cn(
                                      "grid size-4 shrink-0 place-items-center rounded border transition-colors",
                                      on
                                        ? "border-foreground bg-foreground text-background"
                                        : "border-border",
                                    )}
                                  >
                                    {on ? <Check className="size-3" /> : null}
                                  </span>
                                  {logo ? (
                                    <CloudIcon name={logo} className="size-4 shrink-0" />
                                  ) : (
                                    <GitBranch className="size-4 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="min-w-0 flex-1 truncate text-[13px]">
                                    {r.name}
                                  </span>
                                </button>
                              );
                            })
                          )}
                        </div>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {selected.size} of {repos.length} selected
                        </p>
                      </>
                    )}
                  </div>

                  {submitted ? (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                      Sift onboarding isn&rsquo;t wired up yet — this is the layout. We&rsquo;ll
                      connect it to the backend next.
                    </p>
                  ) : null}

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep("config")}
                      className="gap-1.5"
                    >
                      <ArrowLeft className="size-4" /> Back
                    </Button>
                    <Button type="submit" disabled={selected.size === 0} className="flex-1 gap-1.5">
                      <SiftMark className="size-4" /> Connect Sift
                    </Button>
                  </div>
                </form>
              )}
            </TooltipProvider>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A labelled block: a bold label, the control, and an optional muted hint below it. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A segmented single-choice control: each option is label + subtitle, with a hover tooltip. */
function ChoiceGroup({
  options,
  value,
  onChange,
  cols,
}: {
  options: readonly Choice[];
  value: string;
  onChange: (v: string) => void;
  cols: 2 | 3;
}) {
  return (
    <div className={cn("grid gap-1.5", cols === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Tooltip key={o.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onChange(o.value)}
                aria-pressed={active}
                className={cn(
                  "group rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-success/50 bg-success/[0.07] ring-1 ring-inset ring-success/20"
                    : "border-border hover:border-foreground/25 hover:bg-accent/50",
                )}
              >
                <span
                  className={cn(
                    "mb-2 grid size-7 place-items-center rounded-md border transition-colors",
                    active
                      ? "border-success/30 bg-success/15 text-success"
                      : "border-border bg-muted/40 text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <o.Icon className="size-4" />
                </span>
                <span className="block text-[13px] font-medium">{o.label}</span>
                <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
                  {o.desc}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[220px] text-center leading-snug">
              {o.tip}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
