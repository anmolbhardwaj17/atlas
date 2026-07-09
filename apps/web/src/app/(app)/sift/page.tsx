import {
  ArrowRight,
  BookOpen,
  Bug,
  Check,
  Cpu,
  GitPullRequest,
  MessagesSquare,
  ServerOff,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import { SiftMark } from "@/components/sift-mark";
import { SetBreadcrumbs } from "@/components/breadcrumb-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Sift — AI code review, positioned as a product under the Atlas umbrella. Onboarding isn't wired
 * yet, so the primary CTA reads "Coming soon"; the page explains what Sift is, why it's good, and
 * how it snaps into the Atlas graph (review a PR → trace an infra incident back to the exact
 * change). Once an org enables Sift, this same route becomes its Sift dashboard.
 */

const VALUE_PROPS = [
  {
    icon: Cpu,
    title: "Two-model review pipeline",
    body: "A primary model reviews each changed file; a second model runs critic and holistic passes to catch logic and design issues a single pass misses.",
  },
  {
    icon: ShieldCheck,
    title: "20+ linters, Semgrep & CodeQL",
    body: "Static analysis across Python, TypeScript, and Go — plus optional Semgrep and CodeQL — fused with semantic embeddings for real context, not just syntax.",
  },
  {
    icon: Bug,
    title: "Severity-tagged findings",
    body: "Every comment is labelled — bug, security, warning, suggestion, or informational — so reviewers see what actually needs attention first.",
  },
  {
    icon: ServerOff,
    title: "No seats, no servers",
    body: "Sift runs on your own GitHub Actions with your own model keys. Nothing to host, no per-seat pricing — bring Claude, GPT, Gemini, DeepSeek, or a local Ollama model.",
  },
  {
    icon: GitPullRequest,
    title: "Right inside the PR",
    body: "Reviews post as native GitHub comments and checks. Turn on branch protection to gate merges on the sift/review check — clean PRs pass automatically.",
  },
  {
    icon: MessagesSquare,
    title: "Learns from your team",
    body: "Emoji reactions and /feedback commands feed a per-repo quality signal that conditions future reviews, so Sift gets sharper on your codebase over time.",
  },
] as const;

const SETUP_STEPS = [
  {
    title: "Connect GitHub",
    body: "Atlas already links your repositories. Sift reuses that connection — no second integration to manage.",
  },
  {
    title: "Enable Sift & pick your models",
    body: "Choose a model preset (or bring your own keys) and the review effort — from a single fast pass to a full agentic loop.",
  },
  {
    title: "Sift adds a review workflow",
    body: "A GitHub Actions workflow is dropped into your repos. From then on, every pull request is reviewed automatically.",
  },
  {
    title: "Findings flow into Atlas",
    body: "Each review becomes part of your knowledge graph — so a production incident can be traced through the deploy to the exact PR and what Sift flagged on it.",
  },
] as const;

export default function SiftPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <SetBreadcrumbs items={[{ label: "Sift" }]} />

      {/* Hero */}
      <section className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-border bg-card">
          <SiftMark className="size-8" />
        </div>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-3xl font-semibold tracking-tight">Sift</h1>
              <Badge variant="secondary" className="font-medium">
                Coming soon
              </Badge>
            </div>
            <p className="text-lg text-muted-foreground">
              AI code review, wired into your Atlas graph.
            </p>
          </div>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Sift reviews every pull request with semantic, logic-aware analysis — catching bugs and
            security issues that linters and tired reviewers miss. Under the Atlas umbrella it does
            more than review: its findings join your knowledge graph, so when something breaks in
            production you can trace it back to the change that caused it.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button disabled>
              Coming soon
              <ArrowRight className="size-4" />
            </Button>
            <Button variant="outline" asChild>
              <a href="https://www.sift-agent.com/docs" target="_blank" rel="noreferrer noopener">
                <BookOpen className="size-4" />
                Read the docs
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Why Sift */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Why Sift</h2>
          <p className="text-sm text-muted-foreground">
            Deeper than a linter, cheaper than a review seat, and honest about severity.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VALUE_PROPS.map((v) => (
            <Card key={v.title}>
              <CardContent className="space-y-2.5 p-5">
                <div className="grid size-9 place-items-center rounded-lg border border-border bg-background text-foreground">
                  <v.icon className="size-4" />
                </div>
                <h3 className="text-sm font-semibold">{v.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{v.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Sift + Atlas */}
      <section>
        <Card className="overflow-hidden">
          <CardContent className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:items-start md:gap-8 md:p-8">
            <div className="flex items-center gap-2 text-foreground">
              <SiftMark className="size-6" />
              <span className="text-muted-foreground">×</span>
              <Waypoints className="size-6" />
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">
                Sift and Atlas — better together
              </h2>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Atlas maps your infrastructure, code, and deployments into one continuously-updated
                graph. Sift adds a review of every change flowing through it. Connected, they close
                the loop that matters most: when an alarm fires, Atlas can walk from the failing
                service → the deploy that shipped it → the pull request → and the exact issues Sift
                flagged on that PR — a cited path from symptom to cause, not a guess.
              </p>
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="rounded-full border border-border px-2 py-0.5">Incident</span>
                <span className="self-center">→</span>
                <span className="rounded-full border border-border px-2 py-0.5">Service</span>
                <span className="self-center">→</span>
                <span className="rounded-full border border-border px-2 py-0.5">Deploy</span>
                <span className="self-center">→</span>
                <span className="rounded-full border border-border px-2 py-0.5">Pull request</span>
                <span className="self-center">→</span>
                <span className="rounded-full border border-border px-2 py-0.5">Sift findings</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* How you'll set it up */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">How you&rsquo;ll set it up</h2>
          <p className="text-sm text-muted-foreground">
            A few steps, most of them already done because you&rsquo;re on Atlas.
          </p>
        </div>
        <ol className="space-y-3">
          {SETUP_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <div className="space-y-0.5 pt-0.5">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Dashboard teaser */}
      <section>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Check className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Your Sift dashboard lives here</p>
                <p className="text-sm text-muted-foreground">
                  Once Sift is enabled for your organization, this page becomes your dashboard —
                  review volume, findings by severity, and the changes it caught.
                </p>
              </div>
            </div>
            <Button disabled className="shrink-0">
              Coming soon
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
