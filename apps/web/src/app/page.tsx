import Link from "next/link";
import { ShieldCheck, ScanSearch, Siren } from "lucide-react";
import { getSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AtlasLogo, AtlasAiMark } from "@/components/brand";
import { Reveal } from "@/components/landing/reveal";
import { GraphVisual } from "@/components/landing/graph-visual";
import { IntegrationsOrbit } from "@/components/landing/integrations-orbit";
import { AskDemo } from "@/components/landing/ask-demo";
import { CertaintyScale } from "@/components/landing/certainty-scale";
import { BlastDemo } from "@/components/landing/blast-demo";
import { TraceDemo } from "@/components/landing/trace-demo";
import { CloudIcon } from "@/components/cloud-icon";

export const dynamic = "force-dynamic";

/** Matches the login screen's hero exactly - the front doors must look like one product. */
const HERO_BG = "radial-gradient(120% 110% at 18% 12%, #3d3d3d 0%, #1a1a1a 45%, #050505 100%)";

const ALERTS = ["slack-icon", "discord-icon", "microsoft-teams"];

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
            {/* Spins, exactly as it does in the app sidebar - same mark, same behaviour. */}
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
            <p className="flex items-center gap-2.5 text-sm font-medium text-neutral-500">
              <span>Live</span>
              <span className="size-1 rounded-full bg-neutral-300" aria-hidden="true" />
              <span>Cited</span>
              <span className="size-1 rounded-full bg-neutral-300" aria-hidden="true" />
              <span>Read-only</span>
            </p>
            <h1 className="mt-4 text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Nobody knows how the whole system fits together.
            </h1>
            <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-neutral-600">
              It lives in a dozen consoles, a wiki nobody trusts, and the heads of the three people
              who were there. Atlas reads your cloud and your code and keeps one live map of what
              you actually run - so the answer is a question away, not an afternoon.
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
                and fainter than the product's own (gap 16 vs 22, ~0.16 alpha vs 0.25) - the map is
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
                <div className="px-8 pb-8 sm:px-12">
                  <GraphVisual />
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

        {/* ── Trace it back ──────────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70 bg-neutral-50/60">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2 lg:items-center lg:gap-16">
            <Reveal>
              <div>
                <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  Trace exactly what broke, in minutes.
                </h2>
                <p className="mt-5 text-balance leading-relaxed text-neutral-600">
                  Your monitoring already told you something is wrong. It can&rsquo;t tell you why.
                  Atlas picks up where the alert stops: it knows which service that is, what
                  deployed to it, which pull request was in that deploy and which ticket asked for
                  it - so instead of five people opening five consoles, you get a ranked list of
                  what most likely caused it, each showing the evidence it used.
                </p>
                <p className="mt-4 text-balance leading-relaxed text-neutral-600">
                  And when it genuinely can&rsquo;t tell, it says so, rather than picking the most
                  plausible-sounding change and letting you chase it.
                </p>
              </div>
            </Reveal>
            <Reveal delay={90} variant="pop">
              {/* A trace runs BACKWARDS through time and is BUILT one edge at a time - so it plays
                  rather than sitting there. See TraceDemo. */}
              <TraceDemo />
            </Reveal>
          </div>
        </section>

        {/* ── Blast radius ─────────────────────────────────────────────────────────────────────
            The mirror of the trace: backwards answers "what broke", forwards answers "what will".
            Worth its own beat because it's the sharpest distinction from monitoring — monitoring is
            definitionally after the fact, and this is the question you ask before you touch
            anything. It also puts the graph itself back at the centre (P1): the answer is a
            traversal, not a metric. */}
        <section className="border-t border-neutral-200/70">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-2 lg:items-center lg:gap-16">
            <Reveal delay={80} variant="pop">
              {/* Propagation, played out - see BlastDemo. A static list states the answer but not
                  the idea, which is that impact travels. */}
              <BlastDemo />
            </Reveal>

            <Reveal>
              <div>
                <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  And what breaks if you touch it.
                </h2>
                <p className="mt-5 text-balance leading-relaxed text-neutral-600">
                  The same graph runs forwards. Before you retire a bucket, resize a database or
                  deprecate an endpoint, Atlas can tell you everything that depends on it and how -
                  including the service in another cloud that nobody remembered was calling it.
                </p>
                <p className="mt-4 text-balance leading-relaxed text-neutral-600">
                  This is the question monitoring can&rsquo;t answer, because it only knows what has
                  already gone wrong.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── Atlas AI ───────────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-16">
          <Reveal>
            {/* The mark sits INSIDE the sentence - Atlas AI introducing itself by name, with its
                own face, rather than a logo parked in a corner above a heading. */}
            <h2 className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-center text-3xl font-semibold tracking-tight sm:text-4xl">
              <span>Meet</span>
              <AtlasAiMark size={36} className="size-9" />
              <span>Atlas AI</span>
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-balance text-center leading-relaxed text-neutral-600">
              An agent that reads your graph, not the internet - and shows you where every answer
              came from.
            </p>
          </Reveal>

          <Reveal delay={100} variant="pop">
            <div className="mx-auto mt-8 max-w-2xl">
              <AskDemo />
            </div>
          </Reveal>

          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            {[
              {
                title: "Grounded in your estate",
                body: "It answers from the resources, deploys and repositories Atlas has actually read - so it can follow a dependency six hops out and still be talking about your system.",
              },
              {
                title: "Cited, every claim",
                body: "Each statement carries a link to the exact node it came from. Checking its work is one click, not a leap of faith.",
              },
              {
                title: "Honest about the gaps",
                body: "When your data doesn’t support an answer, it says so and names what it couldn’t see - rather than producing something plausible.",
              },
            ].map((c, i) => (
              <Reveal key={c.title} delay={i * 90}>
                <div>
                  <p className="font-medium tracking-tight">{c.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-500">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ── Certainty ────────────────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70 bg-neutral-50/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <Reveal>
                <div>
                  <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                    It tells you when it isn&rsquo;t sure.
                  </h2>
                  <p className="mt-5 text-balance leading-relaxed text-neutral-600">
                    A map you can&rsquo;t trust is worse than no map, because you&rsquo;ll act on
                    it. So every fact in Atlas carries where it came from and how confident it is,
                    and &ldquo;I don&rsquo;t know&rdquo; is a real answer the product is allowed to
                    give.
                  </p>
                  <p className="mt-4 text-balance leading-relaxed text-neutral-600">
                    When two readings conflict, you get both, marked uncertain - never one confident
                    guess.
                  </p>
                </div>
              </Reveal>
              {/* Demonstrated, not listed - the same link drawn at each confidence. See CertaintyScale. */}
              <CertaintyScale />
            </div>
          </div>
        </section>

        {/* ── Integrations + alerting ────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-8">
              <Reveal>
                <div>
                  <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                    It reads what you already use.
                  </h2>
                  <p className="mt-5 text-balance leading-relaxed text-neutral-600">
                    Cloud accounts, repositories, pipelines, issue trackers. Atlas pulls them into
                    one graph so the boundaries between them stop being your problem - the ticket,
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

        {/* ── Security + compliance ────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70 bg-neutral-50/60">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-24 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <Reveal className="lg:order-2">
              <div>
                <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                  The questions that used to take an afternoon.
                </h2>
                <p className="mt-5 text-balance leading-relaxed text-neutral-600">
                  Both of these need the cloud side and the code side in the same place at the same
                  time. That&rsquo;s the whole reason the graph exists.
                </p>
              </div>
            </Reveal>

            {/* Posed as questions, answered underneath - the same shape as asking Atlas, because
                that is literally how you get these answers. Two boxed cards said "features"; this
                says "here is what you'd ask, and here is what comes back". */}
            <div className="space-y-8 lg:order-1">
              {[
                {
                  icon: ScanSearch,
                  tone: "border-danger/30 bg-danger/10 text-danger",
                  q: "Which of our vulnerabilities are actually reachable?",
                  a: "A known CVE matters far more when the thing carrying it is open to the internet. Atlas sees the package and the security group at once, so it can tell you which handful of your findings are both - instead of a list of nine hundred sorted by severity.",
                },
                {
                  icon: ShieldCheck,
                  tone: "border-success/30 bg-success/10 text-success",
                  q: "Are we actually compliant?",
                  a: "Continuous checks against the technical controls in PCI, CIS, NIST, ISO 27001, HIPAA and GDPR - plus an explicit list of the ones no tool can assess for you, so nobody mistakes a green dashboard for an audit.",
                },
              ].map((c, i) => (
                <Reveal key={c.q} delay={i * 100}>
                  <div className="flex gap-4">
                    <span
                      className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border ${c.tone}`}
                    >
                      <c.icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-base font-medium tracking-tight">{c.q}</p>
                      <p className="mt-2 text-sm leading-relaxed text-neutral-500">{c.a}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Read-only ──────────────────────────────────────────────────────────────────────────
            Light, deliberately. This used to be a dark card sitting immediately above the dark
            close — two identical black slabs back to back, which flattened both. Keeping the dark
            treatment for the close alone gives the page one held breath at the end instead of two.
            A calm, unornamented statement also suits the content better: this is the reassurance a
            security reviewer is looking for, and reassurance shouldn't shout. */}
        <section className="mx-auto max-w-4xl px-6 py-20">
          <Reveal>
            {/* No circle around the shield: a ringed icon reads as a status chip, and this is a
                statement, not a badge. Heading and mark share a line so the section keeps one
                alignment instead of switching from centred to left halfway down. */}
            <div className="flex items-center gap-3.5">
              <ShieldCheck className="size-8 shrink-0 text-success" />
              <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                Read-only, all the way down.
              </h2>
            </div>
          </Reveal>

          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <Reveal delay={80}>
              <p className="leading-relaxed text-neutral-600">
                Every connection Atlas makes - cloud accounts, repositories, pipelines, issue
                trackers, chat - is granted read scopes and nothing more. That isn&rsquo;t a setting
                you have to trust us to honour: there is no code path in the product that writes to
                any of them, so the worst a bug can do is show you something wrong.
              </p>
            </Reveal>
            <Reveal delay={160}>
              <p className="leading-relaxed text-neutral-600">
                Which makes this an easy thing to approve. No agents in your VPC, no write
                credentials to rotate, no blast radius to argue about in review - and every
                organisation&rsquo;s data isolated at the database level, not by a filter someone
                remembered to add.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ── Close ───────────────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-8">
          <Reveal variant="pop">
            <div
              className="relative overflow-hidden rounded-3xl px-8 py-20 text-center text-white shadow-sm sm:px-16"
              style={{ background: HERO_BG }}
            >
              <AtlasLogo
                size={640}
                className="pointer-events-none absolute -right-40 -top-52 size-[640px] opacity-[0.06] [filter:invert(1)]"
              />
              <AtlasLogo
                size={420}
                className="pointer-events-none absolute -bottom-40 -left-28 size-[420px] opacity-[0.05] [filter:invert(1)]"
              />
              <div className="relative">
                <h2 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                  See everything you run.
                </h2>
                <p className="mx-auto mt-5 max-w-md text-balance leading-relaxed text-white/70">
                  Connect a read-only role and watch the map build itself.
                </p>
                <div className="mt-9 flex justify-center">
                  <Button
                    asChild
                    size="lg"
                    className="h-12 bg-white px-8 text-neutral-900 hover:bg-white/90"
                  >
                    <Link href={cta.href}>{cta.label}</Link>
                  </Button>
                </div>
                <p className="mt-6 text-xs text-white/40">
                  Read-only access. No agents to deploy. Nothing to uninstall if you walk away.
                </p>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────────────────────────
          Deliberately thin. A footer that lists the product's features and its integrations is just
          repeating the page to someone who has already read it - the page above covers both, at
          length, with pictures. What belongs here is what a footer is actually for: who this is,
          how to reach them, and the legal links. The layout has room for more columns when there
          is genuinely more to say (docs, changelog, careers). */}
      <footer className="border-t border-neutral-200/70">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <AtlasLogo size={26} spin className="size-[26px]" />
                <span className="text-base font-semibold tracking-tight">Atlas</span>
              </div>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-neutral-500">
                One live map of everything you run and ship, built from read-only access to the
                tools you already use.
              </p>
            </div>

            <div className="flex gap-16">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
                  Legal
                </p>
                <ul className="mt-4 space-y-2.5">
                  <li>
                    <Link
                      href="/legal/privacy"
                      className="text-sm text-neutral-600 transition-colors hover:text-neutral-900"
                    >
                      Privacy
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/legal/terms"
                      className="text-sm text-neutral-600 transition-colors hover:text-neutral-900"
                    >
                      Terms
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-neutral-400">
                  Contact
                </p>
                <ul className="mt-4 space-y-2.5">
                  <li>
                    <a
                      href="mailto:hello@atlas.dev"
                      className="text-sm text-neutral-600 transition-colors hover:text-neutral-900"
                    >
                      hello@atlas.dev
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-12 border-t border-neutral-200 pt-6">
            <p className="text-xs text-neutral-400">&copy; {new Date().getFullYear()} Atlas</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
