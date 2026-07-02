"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight } from "lucide-react";

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
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-7">
      {/* Subtle monochrome accent glow - the home's headline interaction (P1). */}
      <div
        className="pointer-events-none absolute -right-16 -top-20 size-52 rounded-full bg-primary/5 blur-3xl"
        aria-hidden
      />
      <div className="relative">
        <div className="mb-1.5 flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <h2 className="text-base font-semibold">Ask Atlas</h2>
        </div>
        <p className="mb-4 max-w-xl text-sm text-muted-foreground">
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
            className="w-full rounded-xl border border-border bg-background py-3 pl-4 pr-[5.5rem] text-[15px] shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20 sm:pr-24"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Ask <ArrowRight className="size-4" />
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Try</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => go(ex)}
              className="rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
