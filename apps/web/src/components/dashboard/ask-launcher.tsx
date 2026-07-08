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
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 text-foreground shadow-sm sm:p-7">
      {/* Brand-green glow so the AI hero still stands out on a light card (P1 — AI is the interface). */}
      <div
        className="pointer-events-none absolute -right-16 -top-20 size-52 rounded-full bg-brand/15 blur-3xl"
        aria-hidden
      />
      {/* Big Atlas company mark, green-tinted, bleeding off the top-right corner. The PNG is
          monochrome, so we recolour it to brand green by masking a green box with its shape. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 hidden size-[280px] bg-brand/[0.12] sm:block"
        style={{
          maskImage: "url(/atlas-logo.png)",
          maskSize: "contain",
          maskRepeat: "no-repeat",
          maskPosition: "center",
          WebkitMaskImage: "url(/atlas-logo.png)",
          WebkitMaskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
        }}
      />
      <div className="relative">
        <div className="mb-1.5 flex items-center gap-1.5">
          <AtlasAiMark size={26} className="-ml-1 size-[26px] shrink-0" />
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
          className="relative max-w-3xl"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. What depends on the payments database?"
            aria-label="Ask Atlas a question"
            className="w-full rounded-xl border border-border bg-background py-3 pl-4 pr-[5.5rem] text-[15px] shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-foreground/40 focus:ring-2 focus:ring-ring/20 sm:pr-24"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            Ask <ArrowRight className="size-4" />
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Try</span>
          <span className="h-4 w-px shrink-0 bg-border" aria-hidden />
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => go(ex)}
              className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
