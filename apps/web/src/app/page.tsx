import Link from "next/link";
import { Plug, Waypoints, Sparkles, ShieldCheck, Activity, ScanSearch } from "lucide-react";
import { getSession } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { AtlasLogo } from "@/components/brand";
import { Reveal } from "@/components/landing/reveal";
import { GraphVisual } from "@/components/landing/graph-visual";

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

const CAPABILITIES = [
  {
    icon: Activity,
    title: "Know what broke, and what shipped it",
    body: "When something degrades, Atlas traces it back through the service to the deploy and the pull request that caused it — and shows its working.",
  },
  {
    icon: ScanSearch,
    title: "Find what's exposed and vulnerable",
    body: "A known CVE matters far more when it's reachable from the internet. Atlas knows which of your dependencies are both.",
  },
  {
    icon: ShieldCheck,
    title: "Answer the compliance question honestly",
    body: "Continuous checks against the technical controls in PCI, CIS, NIST, ISO 27001, HIPAA and GDPR — including the ones it can't assess for you.",
  },
];

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
  const cta = session
    ? { href: "/dashboard", label: "Go to dashboard" }
    : { href: "/login", label: "Get started" };

  return (
    <div className="theme-light min-h-dvh bg-white text-neutral-900">
      {/* ── Header ─────────────────────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-neutral-200/70 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <AtlasLogo size={28} className="size-7" />
            <span className="text-lg font-semibold tracking-tight">Atlas</span>
          </Link>
          <nav className="flex items-center gap-1.5">
            {!session && (
              <Button asChild variant="ghost" className="text-neutral-600 hover:text-neutral-900">
                <Link href="/login">Log in</Link>
              </Button>
            )}
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
            <div
              className="relative overflow-hidden rounded-2xl p-8 shadow-sm sm:p-12"
              style={{ background: HERO_BG }}
            >
              <AtlasLogo
                size={520}
                className="pointer-events-none absolute -right-24 -top-32 size-[520px] opacity-[0.05] [filter:invert(1)]"
              />
              <div className="relative">
                {/* Below ~600px the diagram would scale down to ~5px labels — legible to nobody.
                    Wide content scrolls inside its own container rather than shrinking past the
                    point of meaning; the page itself never scrolls sideways. */}
                <div className="-mx-1 overflow-x-auto px-1 pb-1">
                  <div className="min-w-[560px]">
                    <GraphVisual />
                  </div>
                </div>
                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/10 pt-5 text-xs text-white/50">
                  <span className="flex items-center gap-2">
                    <span className="h-px w-6 bg-white/40" /> Observed
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className="h-px w-6"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(to right, rgba(255,255,255,0.55) 0 4px, transparent 4px 8px)",
                      }}
                    />
                    Inferred
                  </span>
                  <span className="ml-auto">A real slice of an Atlas graph.</span>
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

        {/* ── Capabilities ─────────────────────────────────────────────────────────────────── */}
        <section className="border-t border-neutral-200/70 bg-neutral-50/60">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <Reveal>
              <h2 className="max-w-2xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
                The questions that used to take an afternoon.
              </h2>
            </Reveal>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {CAPABILITIES.map((c, i) => (
                <Reveal key={c.title} delay={i * 90}>
                  <div className="h-full rounded-2xl border border-neutral-200 bg-white p-6">
                    <c.icon className="size-5 text-neutral-400" />
                    <p className="mt-5 font-medium leading-snug">{c.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-neutral-500">{c.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
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
            <Link href="/login" className="transition-colors hover:text-neutral-900">
              Log in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
