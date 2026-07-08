"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AtlasAiMark } from "@/components/brand";

/**
 * The "Ask Atlas" hero (docs/09 §5.2) - the AI is the interface (P1), so the home invites a
 * question first. Submitting (or clicking an example) routes to /ask with the question
 * prefilled, where the grounded, cited answer streams.
 */
const EXAMPLES = [
  "Which repositories have no CI/CD pipeline?",
  "Who are the top contributors this month?",
  "What's the blast radius of the payments service?",
];

export function AskLauncher() {
  const router = useRouter();
  const [q, setQ] = useState("");

  const go = (question: string): void => {
    const t = question.trim();
    router.push(t ? `/ask?q=${encodeURIComponent(t)}` : "/ask");
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-transparent bg-neutral-900 p-6 text-white sm:p-7">
      {/* Brand-green glow so the AI hero stands out (P1 — the AI is the interface). */}
      <div
        className="pointer-events-none absolute -right-16 -top-20 size-52 rounded-full bg-brand/25 blur-3xl"
        aria-hidden
      />
      <div className="relative">
        <div className="mb-1.5 flex items-center gap-1.5">
          <AtlasAiMark size={26} className="-ml-1 size-[26px] shrink-0" />
          <h2 className="text-base font-semibold">Ask Atlas</h2>
        </div>
        <p className="mb-4 max-w-xl text-sm text-white/70">
          Ask anything about your infrastructure and code - every answer is grounded in your live
          graph and cited back to it.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(q);
          }}
          className="relative"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. What depends on the payments database?"
            aria-label="Ask Atlas a question"
            className="w-full rounded-xl border border-white/15 bg-white/10 py-3 pl-4 pr-[5.5rem] text-[15px] text-white shadow-sm outline-none transition placeholder:text-white/50 focus:border-white/30 focus:ring-2 focus:ring-white/20 sm:pr-24"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-neutral-900 transition hover:opacity-90"
          >
            Ask <ArrowRight className="size-4" />
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/60">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => go(ex)}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70 transition-colors hover:border-white/30 hover:text-white"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
