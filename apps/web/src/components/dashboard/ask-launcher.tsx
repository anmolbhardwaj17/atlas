"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight } from "lucide-react";

/**
 * The "Ask Atlas" hero (docs/09 §5.2) — the AI is the interface (P1), so the home invites a
 * question first. Submitting (or clicking an example) routes to /ask with the question
 * prefilled, where the grounded, cited answer streams.
 */
const EXAMPLES = [
  "What's the blast radius of the orders service?",
  "What spans a cloud or account boundary?",
  "What changed in the last week?",
];

export function AskLauncher() {
  const router = useRouter();
  const [q, setQ] = useState("");

  const go = (question: string): void => {
    const t = question.trim();
    router.push(t ? `/ask?q=${encodeURIComponent(t)}` : "/ask");
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-primary" />
        Ask Atlas about your infrastructure
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. What depends on the payments database?"
          aria-label="Ask Atlas a question"
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Ask <ArrowRight className="size-4" />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => go(ex)}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
