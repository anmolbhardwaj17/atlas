"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AtlasLogo } from "@/components/brand";

// LiquidMetal is a WebGL shader - client-only (no SSR), lazy-loaded so it never blocks paint.
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false, loading: () => <div className="size-[300px]" /> },
);

const STEPS = [
  { title: "Connect in minutes", desc: "Read-only access to AWS and your repositories." },
  { title: "Atlas builds the map", desc: "A live, cited graph of everything you run and ship." },
  { title: "Ask anything", desc: "Answers grounded in your real system, with sources." },
];

/** Sign-in screen (docs/09 login, docs/12 §2.1). Split layout: a branded hero + Google OAuth.
 *  Supabase redirects to /auth/callback to complete the session. Google-only for MVP (docs/12). */
export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle(): Promise<void> {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-white md:grid md:grid-cols-2">
      {/* ── Left: branded hero as an inset green card floating on the white page ── */}
      <aside
        className="relative m-2.5 hidden flex-col justify-end overflow-hidden rounded-2xl p-8 text-white shadow-sm md:m-3 md:flex"
        style={{
          background:
            "radial-gradient(120% 110% at 18% 12%, #1f6b4a 0%, #0e3a28 42%, #071f16 100%)",
        }}
      >
        {/* The liquid-metal mark, floating in the hero. */}
        <div className="pointer-events-none absolute right-0 top-2 opacity-90 [filter:drop-shadow(0_20px_50px_rgba(0,0,0,0.35))]">
          <LiquidMetal
            width={300}
            height={300}
            image="/atlas-logo.png"
            colorBack="#00000000"
            colorTint="#bfeed4"
            repetition={2}
            softness={0.1}
            shiftRed={0.3}
            shiftBlue={0.3}
            distortion={0.07}
            contour={0.4}
            angle={70}
            speed={1}
            scale={0.82}
            fit="contain"
          />
        </div>

        <div className="relative">
          <h2 className="max-w-sm text-4xl font-semibold leading-tight tracking-tight">
            See everything you run.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
            Atlas turns your cloud and code into one live, cited graph, so your whole system finally
            makes sense at a glance.
          </p>

          <ol className="mt-8 grid gap-3 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className={
                  i === 0
                    ? "rounded-xl bg-white p-4 text-neutral-900 shadow-lg"
                    : "rounded-xl border border-white/10 bg-white/5 p-4 text-white/70 backdrop-blur-sm"
                }
              >
                <span
                  className={
                    "grid size-6 place-items-center rounded-full text-xs font-semibold " +
                    (i === 0 ? "bg-neutral-900 text-white" : "bg-white/10 text-white/80")
                  }
                >
                  {i + 1}
                </span>
                <p className="mt-3 text-sm font-medium">{s.title}</p>
                <p className={"mt-0.5 text-xs " + (i === 0 ? "text-neutral-500" : "text-white/50")}>
                  {s.desc}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </aside>

      {/* ── Right: full-height sign-in ── */}
      <section className="relative flex min-h-dvh flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm text-center">
          <div className="mb-8 flex items-center justify-center gap-2.5">
            <AtlasLogo size={40} className="size-10" />
            <span className="text-3xl font-semibold tracking-tight text-neutral-900">Atlas</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Welcome back</h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Use your Google account to continue to your workspace.
          </p>

          <Button onClick={signInWithGoogle} disabled={busy} className="mt-8 h-11 w-full gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white">
              <GoogleIcon className="size-3.5" />
            </span>
            {busy ? "Redirecting…" : "Continue with Google"}
          </Button>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </div>

        {/* Legal links, anchored to the bottom of the panel. */}
        <div className="absolute inset-x-0 bottom-6 flex justify-center gap-5 text-xs text-neutral-400">
          <Link href="/legal/terms" className="transition-colors hover:text-neutral-700">
            Terms of Service
          </Link>
          <Link href="/legal/privacy" className="transition-colors hover:text-neutral-700">
            Privacy Policy
          </Link>
        </div>
      </section>
    </main>
  );
}

/** Google "G" mark (inline SVG, brand colors). */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.48h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.75z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58v-3.1H1.26a12 12 0 0 0 0 10.78l4.01-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.26 6.61l4.01 3.1C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}
