import Link from "next/link";
import { Plug, Waypoints, Sparkles, ShieldCheck, ScanSearch, Siren, Route } from "lucide-react";
import { getSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AtlasLogo, AtlasAiMark } from "@/components/brand";
import { Reveal } from "@/components/landing/reveal";
import { GraphVisual } from "@/components/landing/graph-visual";
import { IntegrationsOrbit } from "@/components/landing/integrations-orbit";
import { CloudIcon } from "@/components/cloud-icon";
import { KIND_LOGO, kindShort } from "@/lib/kind-visual";

export const dynamic = "force-dynamic";

/** Matches the login screen's hero exactly — the two front doors must look like one product. */
const HERO_BG = "radial-gradient(120% 110% at 18% 12%, #3d3d3d 0%, #1a1a1a 45%, #050505 100%)";

const STEPS = [
  {
    icon: Plug,
    title: "Connect in minutes",
    desc: "A read-only role for AWS, an app for your repositories. Nothing to install, nothing to run.",
  },
  {
    icon: Waypoints,
    title: "Atlas builds the map",
    desc: "Services, databases, repositories, deploys and the links between them — kept current on its own.",
  },
  {
    icon: Sparkles,
    title: "Ask anything",
    desc: "Plain questions, answered from your real system, with a source on every claim.",
  },
];

/**
 * The certainty language, stated plainly. This is the section that does the most work: every tool
 * in this space will tell you it has AI, and none of them will tell you when they're guessing.
 */
const CERTAINTY = [
  {
    label: "Observed",
    tone: "bg-success/15 text-success",
    body: "Read directly from your cloud or code. A fact, not an interpretation.",
  },
  {
    label: "Inferred",
    tone: "bg-neutral-900 text-white",
    body: "Worked out from evidence — a matching commit, a deploy config — and labelled with how strongly.",
  },
  {
    label: "AI-suggested",
    tone: "bg-ai-suggested/15 text-ai-suggested",
    body: "A model's proposal, waiting on you. Nothing enters your graph until you confirm it.",
  },
];

const ALERTS = ["slack-icon", "discord-icon", "microsoft-teams"];

/** Citation marker, mirroring the product's CitationLink — provenance is visible, not implied (P4). */
function Cite({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-sm bg-white/15 px-1 align-super text-[9px] font-semibold text-white/80">
      {n}
    </sup>
  );
}

/**
 * Public landing page — Atlas's front door.
 *
 * Built from the login screen's visual language rather than beside it: the same inset dark card on
 * white, the same oversized logo bleeding off a corner, the same restrained mono palette and type
 * scale. The two are the only pages a signed-out visitor sees, so they have to read as one product.
 *
 * Light by design. `.theme-light` pins the light token values for this subtree, so semantic classes
 * like `bg-primary` stay dark-on-white even when the visitor's system (and therefore `html.dark`)
 * is dark — without it the primary button rendered light-on-white and vanished. These pages sit
 * outside the authenticated shell where the theme toggle lives, and a marketing page that changes
 * appearance based on a preference set inside the app is a page nobody has ever actually seen.
 *
 * Reachable whether or not you're signed in — a landing page that redirects logged-in visitors away
 * can't be linked to, which is the one thing a landing page is for. The session only changes which
 * call-to-action makes sense.
 */
export default async function LandingPage() {
  const session = await getSession();
  // ONE call to action, everywhere. Sign-in is Google OAuth only — there is no separate "sign up",
  // so a Log in / Get started pair advertised a choice that doesn't exist and made one door look
  // like two. The label names the OUTCOME, not the mechanism: naming the identity provider on the
  // front door is an implementation detail that reads as a restriction, and the next screen says
  // "Continue with Google" anyway.
  const cta = session
    ? { href: "/dashboard", label: "Go to dashboard" }
    : { href: "/login", label: "Get started" };

  return (
    <div className="theme-light min-h-dvh bg-white text-neutral-900">
      {/* ── Header ─────────────────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            {/* Spins, exactly as it does in the app sidebar — same mark, same behaviour. */}
            <AtlasLogo size={28} spin className="size-7" />
            <span className="text-lg font-semibold tracking-tight">Atlas</span>
          </Link>
          <nav className="flex items-center">
            <Button asChild>
              <Link href={cta.href}>{cta.label}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 pb-8 pt-20 sm:pt-28">
          <div className="motion-stagger max-w-3xl">
            <p className="text-sm font-medium text-neutral-500">Engineering intelligence</p>
            <h1 className="mt-4 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Nobody knows how the whole system fits together.
            </h1>
            <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-neutral-600">
              It lives in a dozen consoles, a wiki nobody trusts, and the heads of the three people
              who were there. Atlas reads your cloud and your code and keeps one live map of what
              you actually run — so the answer is a question away, not an afternoon.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-11 px-7">
                <Link href={cta.href}>{cta.label}</Link>
              </Button>
              <span className="text-sm text-neutral-500">
                Read-only access. No agents to deploy.
              </span>
            </div>
          </div>
        </section>

        {/* The graph, on the dark inset card the login page established. */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <Reveal variant="pop">
            {/* The live map's canvas: a light surface with React Flow's dotted background. Denser
                and fainter than the product's own (gap 16 vs 22, ~0.16 alpha vs 0.25) — the map is
                viewed at varying zoom where a sparser grid reads correctly, but at this fixed size
                the product values rendered as scattered specks rather than as paper texture. */}
            <div
              className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white pt-8 shadow-sm sm:pt-12"
              style={{
                backgroundImage:
                  "radial-gradient(hsl(var(--muted-foreground) / 0.16) 1.3px, transparent 1.3px)",
                backgroundSize: "16px 16px",
              }}
            >
              <div className="relative">
                <div className="overflow-x-auto px-8 pb-8 sm:px-12">
                  <div className="mx-auto min-w-[760px]">
                    <GraphVisual />
                  </div>
                </div>
                {/* Full-bleed white footer: a key belongs on its own ground, not floating on the
                    canvas it describes. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-neutral-200 bg-white px-8 py-4 text-xs text-neutral-500 sm:px-12">
                  <span className="flex items-center gap-2">
                    <span className="h-px w-6 bg-neutral-400" /> Observed
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-px w-6"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(to right, rgb(163 163 163) 0 4px, transparent 4px 8px)",
                      }}
                    />
                    Inferred
                  </span>
                  <span className="ml-auto">Hover a resource to trace what it touches.</span>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70 bg-neutral-50/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <Reveal>
              <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Three steps, then it maintains itself.
              </h2>
            </Reveal>
            <ol className="mt-12 grid gap-5 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <Reveal key={s.title} delay={i * 90}>
                  <li className="h-full rounded-2xl border border-neutral-200 bg-white p-6">
                    <span className="grid size-9 place-items-center rounded-full bg-neutral-900 text-white">
                      <s.icon className="size-4" />
                    </span>
                    <p className="mt-5 font-medium">{s.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-neutral-500">{s.desc}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Certainty ────────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
            <Reveal>
              <div>
                <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  It tells you when it isn&rsquo;t sure.
                </h2>
                <p className="mt-5 text-balance leading-relaxed text-neutral-600">
                  A map you can&rsquo;t trust is worse than no map, because you&rsquo;ll act on it.
                  So every fact in Atlas carries where it came from and how confident it is, and
                  &ldquo;I don&rsquo;t know&rdquo; is a real answer the product is allowed to give.
                </p>
                <p className="mt-4 text-balance leading-relaxed text-neutral-600">
                  When two readings conflict, you get both, marked uncertain — never one confident
                  guess.
                </p>
              </div>
            </Reveal>
            <div className="space-y-3">
              {CERTAINTY.map((c, i) => (
                <Reveal key={c.label} delay={i * 90}>
                  <div className="flex items-start gap-4 rounded-2xl border border-neutral-200 p-5">
                    <span
                      className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${c.tone}`}
                    >
                      {c.label}
                    </span>
                    <p className="text-sm leading-relaxed text-neutral-600">{c.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Trace it back ──────────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70 bg-neutral-50/60">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2 lg:items-center lg:gap-16">
            <Reveal>
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600">
                  <Route className="size-3.5" /> Root cause
                </span>
                <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  Trace exactly what broke, in minutes.
                </h2>
                <p className="mt-5 text-balance leading-relaxed text-neutral-600">
                  Something starts erroring at 2am. Atlas already knows which service it is, what
                  deployed to it, which pull request was in that deploy and which ticket asked for
                  it. Instead of five people opening five consoles, you get a ranked list of what
                  most likely caused it — each one showing the evidence it used.
                </p>
                <p className="mt-4 text-balance leading-relaxed text-neutral-600">
                  And when it genuinely can&rsquo;t tell, it says so, rather than picking the most
                  plausible-sounding change and letting you chase it.
                </p>
              </div>
            </Reveal>
            <Reveal delay={90} variant="pop">
              {/* A trace runs BACKWARDS through time, so draw it that way. The numbered list said
                  "five things happened" without showing that each one was found by walking one edge
                  further back — the timestamps and the rail are what make it read as a trace rather
                  than a checklist, and the culprit needs to look like the end of the line. */}
              <div className="relative">
                <div
                  className="absolute bottom-8 left-[102px] top-8 w-px bg-neutral-200"
                  aria-hidden="true"
                />
                <ol className="space-y-1">
                  {[
                    {
                      time: "02:00",
                      icon: "aws-ecs",
                      title: "checkout is unhealthy",
                      detail: "5xx rate 12% · threshold 2%",
                      alarm: true,
                    },
                    {
                      time: "01:58",
                      icon: "aws-elb",
                      title: "Traffic still arriving",
                      detail: "checkout-alb · target group healthy",
                    },
                    {
                      time: "01:46",
                      icon: "bitbucket",
                      title: "deploy-production ran",
                      detail: "14 minutes before the alarm",
                    },
                    {
                      time: "01:44",
                      icon: "bitbucket",
                      title: "PR #1482 merged",
                      detail: "“retry budget for orders-db”",
                      culprit: true,
                    },
                    {
                      time: "yesterday",
                      icon: "jira",
                      title: "PAY-318",
                      detail: "payments board · reported by @priya",
                    },
                  ].map((r) => (
                    <li key={r.title} className="flex items-start gap-4">
                      <span className="w-[70px] shrink-0 pt-[11px] text-right text-xs tabular-nums text-neutral-400">
                        {r.time}
                      </span>
                      <span
                        className={
                          "relative z-10 mt-1.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-white " +
                          (r.alarm
                            ? "border-danger/40 ring-4 ring-danger/10"
                            : "border-neutral-200")
                        }
                      >
                        <CloudIcon name={r.icon} className="size-4" />
                      </span>
                      <span
                        className={
                          "min-w-0 flex-1 rounded-xl border px-4 py-2.5 " +
                          (r.culprit ? "border-danger bg-danger/[0.04]" : "border-transparent")
                        }
                      >
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium">{r.title}</span>
                          {r.culprit ? (
                            <span className="rounded-full bg-danger px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                              Most likely cause
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-neutral-500">{r.detail}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Atlas AI ───────────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <Reveal variant="pop">
            <div
              className="relative overflow-hidden rounded-2xl p-8 text-white shadow-sm sm:p-14"
              style={{ background: HERO_BG }}
            >
              <AtlasLogo
                size={460}
                className="pointer-events-none absolute -right-28 -top-28 size-[460px] opacity-[0.05] [filter:invert(1)]"
              />
              <div className="relative grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
                <div>
                  <div className="flex items-center gap-3">
                    <AtlasAiMark size={40} className="size-10" />
                    <div>
                      <p className="text-sm font-semibold">Atlas AI</p>
                      <p className="text-xs text-white/50">Included, on your graph</p>
                    </div>
                  </div>

                  <h2 className="mt-7 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                    Ask it like you&rsquo;d ask the person who built it.
                  </h2>
                  <p className="mt-5 text-balance leading-relaxed text-white/70">
                    Atlas AI is an agent that reads your graph, not the internet. It can follow a
                    dependency six hops out, work out who owns a service, compare what changed
                    between two deploys, or explain why something is exposed — then keep going when
                    you ask the follow-up.
                  </p>
                  <p className="mt-4 text-balance leading-relaxed text-white/70">
                    Every claim carries a citation to the exact resource it came from, so you can
                    check its work in one click. When your data doesn&rsquo;t support an answer, it
                    says so instead of inventing one.
                  </p>

                  {/* The range of questions is the point — one example only shows the format. */}
                  <p className="mt-8 text-xs font-medium uppercase tracking-widest text-white/40">
                    Things people actually ask
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      "What changed before the 2am spike?",
                      "Which services are internet-exposed?",
                      "Who owns checkout?",
                      "What breaks if I retire this bucket?",
                    ].map((q) => (
                      <span
                        key={q}
                        className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1.5 text-xs text-white/65"
                      >
                        {q}
                      </span>
                    ))}
                  </div>
                </div>

                {/* A worked answer, in the product's own citation style. */}
                <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
                  <p className="text-sm text-white/45">What talks to orders-db, and who owns it?</p>
                  <div className="mt-4 flex gap-3">
                    <AtlasAiMark size={22} className="mt-0.5 size-[22px] shrink-0" />
                    <p className="text-sm leading-relaxed text-white/85">
                      Two services write to{" "}
                      <span className="font-medium text-white">orders-db</span>: the{" "}
                      <span className="font-medium text-white">checkout</span> ECS service
                      <Cite n={1} /> and the{" "}
                      <span className="font-medium text-white">orders-webhook</span> Lambda
                      <Cite n={2} />. The repository behind both is owned by{" "}
                      <span className="font-medium text-white">@payments</span>
                      <Cite n={3} /> — five people.
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-1.5 border-t border-white/10 pt-4">
                    {["aws.rds.instance", "aws.lambda.function", "bitbucket.repository"].map(
                      (k, i) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.07] px-2 py-1 text-[11px] text-white/60"
                        >
                          <span className="text-white/40">{i + 1}</span>
                          <CloudIcon name={KIND_LOGO[k] as string} className="size-3.5" />
                          {kindShort(k)}
                        </span>
                      ),
                    )}
                  </div>
                  <p className="mt-4 border-t border-white/10 pt-4 text-xs text-white/40">
                    Ask from the app, or from Slack without leaving the channel.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Integrations + alerting ────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70 bg-neutral-50/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-8">
              <Reveal>
                <div>
                  <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                    It reads what you already use.
                  </h2>
                  <p className="mt-5 text-balance leading-relaxed text-neutral-600">
                    Cloud accounts, repositories, pipelines, issue trackers. Atlas pulls them into
                    one graph so the boundaries between them stop being your problem — the ticket,
                    the pull request and the running container are finally the same story.
                  </p>

                  <div className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
                    <div className="flex items-center gap-2.5 border-b border-neutral-200 px-5 py-3">
                      <Siren className="size-4 text-neutral-400" />
                      <p className="text-sm font-medium">It tells you where you already look</p>
                    </div>

                    {/* A real alert, in the shape Atlas actually sends: what broke, how far past
                        threshold, and the change that most likely caused it. */}
                    <div className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-neutral-200 bg-neutral-50">
                          <CloudIcon name="slack-icon" className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-neutral-400">
                            #eng-alerts &middot; Atlas &middot; just now
                          </p>
                          <p className="mt-1.5 flex items-center gap-2 text-sm font-medium">
                            <span className="size-1.5 shrink-0 rounded-full bg-danger" />
                            checkout is unhealthy
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-neutral-500">
                            5xx rate at 12% (threshold 2%). Most likely cause:{" "}
                            <span className="font-medium text-neutral-700">PR #1482</span>, deployed
                            14 minutes ago.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 border-t border-neutral-200 bg-neutral-50/60 px-5 py-3">
                      <span className="text-xs text-neutral-500">Delivered to</span>
                      <span className="flex items-center gap-2.5">
                        {ALERTS.map((n) => (
                          <CloudIcon key={n} name={n} className="size-4 opacity-80" />
                        ))}
                      </span>
                      <span className="text-xs text-neutral-400">or email</span>
                    </div>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={120} variant="pop">
                <IntegrationsOrbit />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── Security + compliance ──────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <h2 className="max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              The questions that used to take an afternoon.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {[
              {
                icon: ScanSearch,
                title: "What’s exposed and vulnerable?",
                body: "A known CVE matters far more when it is reachable from the internet. Atlas knows which of your dependencies are both, because it can see the package and the security group at the same time.",
              },
              {
                icon: ShieldCheck,
                title: "Are we actually compliant?",
                body: "Continuous checks against the technical controls in PCI, CIS, NIST, ISO 27001, HIPAA and GDPR — and an honest list of the ones no tool can assess for you.",
              },
            ].map((c, i) => (
              <Reveal key={c.title} delay={i * 90}>
                <div className="h-full rounded-2xl border border-neutral-200 p-6">
                  <c.icon className="size-5 text-neutral-400" />
                  <p className="mt-5 font-medium leading-snug">{c.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-500">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Read-only ────────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <Reveal variant="pop">
            <div
              className="relative overflow-hidden rounded-2xl p-10 text-white shadow-sm sm:p-14"
              style={{ background: HERO_BG }}
            >
              <AtlasLogo
                size={440}
                className="pointer-events-none absolute -bottom-32 -left-24 size-[440px] opacity-[0.05] [filter:invert(1)]"
              />
              <div className="relative max-w-2xl">
                <ShieldCheck className="size-6 text-white/60" />
                <h2 className="mt-5 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  Atlas cannot change anything.
                </h2>
                <p className="mt-5 text-balance leading-relaxed text-white/70">
                  Not by policy — by construction. The AWS role we ask for grants reads and nothing
                  else, the repository app is scoped the same way, and there is no code path in the
                  product that writes to your infrastructure. The worst thing a bug in Atlas can do
                  is show you something wrong.
                </p>
                <p className="mt-4 text-balance leading-relaxed text-white/70">
                  Every organisation&rsquo;s data is isolated at the database level, not by a filter
                  someone remembered to add.
                </p>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Close ────────────────────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70">
          <div className="mx-auto max-w-6xl px-6 py-24 text-center">
            <Reveal>
              <div>
                <h2 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                  See everything you run.
                </h2>
                <p className="mx-auto mt-5 max-w-md text-balance leading-relaxed text-neutral-600">
                  Connect a read-only role and watch the map build itself.
                </p>
                <div className="mt-9 flex justify-center">
                  <Button asChild size="lg" className="h-11 px-8">
                    <Link href={cta.href}>{cta.label}</Link>
                  </Button>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-neutral-200/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-neutral-500 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <AtlasLogo size={20} className="size-5 opacity-60" />
            <span>&copy; {new Date().getFullYear()} Atlas</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/legal/privacy" className="transition-colors hover:text-neutral-900">
              Privacy
            </Link>
            <Link href="/legal/terms" className="transition-colors hover:text-neutral-900">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
