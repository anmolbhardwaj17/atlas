"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { CloudIcon } from "@/components/cloud-icon";
import { KIND_LOGO } from "@/lib/kind-visual";

/**
 * The certainty language, in one card.
 *
 * Two earlier passes were wrong in opposite directions: three badge-and-sentence cards (a legend
 * that could have belonged to any product), then three full rows that each redrew the same pair of
 * nodes — which showed the right thing but spent a whole screen repeating its own setup.
 *
 * This states the pair ONCE and varies only what matters: the line between them. Solid, dashed,
 * dotted — the same notation the map draws, so the section teaches the graph's vocabulary rather
 * than describing it. The confirm/reject pair is kept because it's the actual differentiator:
 * plenty of tools have a model guessing at links; the question is whether the guess is presented
 * as a fact.
 *
 * Confirm and Reject actually work. Reading "nothing enters your graph until you confirm it" and
 * then clicking the button that does it is worth more than the sentence alone - the promise becomes
 * a thing you just did. It reverts after a few seconds so the next visitor (and the same one,
 * scrolling back) finds the illustration where they left it.
 */
interface Tier {
  label: string;
  labelClass: string;
  meaning: string;
  dash?: string;
  strokeClass: string;
  pending?: boolean;
}

const TIERS: Tier[] = [
  {
    label: "Observed",
    labelClass: "bg-success/15 text-success",
    meaning: "Read straight from your cloud.",
    strokeClass: "text-neutral-800",
  },
  {
    label: "Inferred",
    labelClass: "bg-neutral-900 text-white",
    meaning: "A matching commit SHA in the deployed image.",
    dash: "5 4",
    strokeClass: "text-neutral-400",
  },
  {
    label: "AI-suggested",
    labelClass: "bg-ai-suggested/15 text-ai-suggested",
    meaning: "A proposal. Not in your graph until you confirm it.",
    dash: "2 4",
    strokeClass: "text-ai-suggested",
    pending: true,
  },
];

function Chip({ name, kind }: { name: string; kind: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 shadow-sm">
      <span className="grid size-5 shrink-0 place-items-center rounded bg-neutral-100">
        <CloudIcon name={KIND_LOGO[kind] as string} className="size-3.5" />
      </span>
      <span className="text-xs font-medium">{name}</span>
    </span>
  );
}

type Decision = "pending" | "confirmed" | "rejected";

/** Long enough to register the outcome, short enough that the page doesn't stay in a used state. */
const REVERT_MS = 6000;

export function CertaintyScale() {
  const [decision, setDecision] = useState<Decision>("pending");

  useEffect(() => {
    if (decision === "pending") return;
    const t = setTimeout(() => setDecision("pending"), REVERT_MS);
    return () => clearTimeout(t);
  }, [decision]);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      {/* The pair, stated once. Everything below varies only the line between them. */}
      <div className="flex items-center justify-between gap-3">
        <Chip name="checkout-api" kind="bitbucket.repository" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-300">
          deploys to
        </span>
        <Chip name="checkout" kind="aws.ecs.service" />
      </div>

      <div className="mt-6 space-y-4 border-t border-neutral-100 pt-5">
        {TIERS.map((t) => {
          const ai = Boolean(t.pending);
          const confirmed = ai && decision === "confirmed";
          const rejected = ai && decision === "rejected";
          return (
            <div
              key={t.label}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-2 transition-opacity duration-300",
                rejected && "opacity-40",
              )}
            >
              <svg
                viewBox="0 0 60 8"
                className={cn(
                  "h-2 w-14 shrink-0 transition-colors duration-300",
                  confirmed ? "text-neutral-800" : t.strokeClass,
                )}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <line
                  x1="0"
                  y1="4"
                  x2="54"
                  y2="4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray={confirmed ? undefined : t.dash}
                  vectorEffect="non-scaling-stroke"
                />
                <path d="M54 1 L60 4 L54 7 z" fill="currentColor" />
              </svg>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-300",
                  confirmed ? "bg-success/15 text-success" : t.labelClass,
                )}
              >
                {confirmed ? "Observed" : t.label}
              </span>
              <p className="min-w-0 flex-1 text-sm text-neutral-500">
                {confirmed
                  ? "Confirmed by you. It's part of the graph now."
                  : rejected
                    ? "Rejected. Atlas won't propose it again."
                    : t.meaning}
              </p>
              {ai && decision === "pending" ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDecision("confirmed")}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:border-success/50 hover:bg-success/10 hover:text-success"
                  >
                    <Check className="size-3" /> Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecision("rejected")}
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:border-neutral-300 hover:text-neutral-600"
                  >
                    <X className="size-3" /> Reject
                  </button>
                </span>
              ) : ai ? (
                <span className="shrink-0 text-xs text-neutral-400 motion-safe:animate-[motion-pop_0.3s_cubic-bezier(0.2,0.8,0.2,1)_both]">
                  {confirmed ? "Added to your graph" : "Dismissed"}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
