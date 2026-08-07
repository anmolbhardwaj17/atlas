"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CloudIcon } from "@/components/cloud-icon";

/**
 * A looping incident trace: each step is found one at a time, walking backwards through time, and
 * only once the chain is complete does the culprit get marked.
 *
 * The order is the argument. A static list says "five things happened"; revealing them in sequence
 * shows that each was found by following one more edge back from the last — which is the actual
 * claim being made about the product. Marking the cause at the END rather than up front matters
 * too: Atlas concludes, it doesn't start from a hunch and rationalise.
 *
 * The rail grows with the reveal so the trace visibly extends rather than sitting there waiting.
 * Reduced motion renders the finished trace immediately, which loses nothing but the pacing.
 */
interface Step {
  time: string;
  icon: string;
  title: string;
  detail: string;
  /** The alarm that started it — the only step that is already red on arrival. */
  alarm?: boolean;
  /** The change Atlas lands on. Marked only after the whole chain is built. */
  culprit?: boolean;
}

const STEPS: Step[] = [
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
];

// Same reasoning as the ask demo: the reveal should feel deliberate, the hold should not feel like
// the animation has stopped. The steps carry the meaning, so they keep most of the budget.
const STEP_MS = 420;
const MARK_MS = 520;
/** Gap between the row lighting up and the verdict landing — the "…got it" beat. */
const BADGE_MS = 320;
/** Long enough to read the verdict and glance back up the chain before it resets. */
const HOLD_MS = 3400;

export function TraceDemo() {
  const [shown, setShown] = useState(0);
  const [marked, setMarked] = useState(false);
  const [badge, setBadge] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let t: ReturnType<typeof setTimeout>;
    if (shown < STEPS.length) {
      t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 220 : STEP_MS);
    } else if (!marked) {
      t = setTimeout(() => setMarked(true), MARK_MS);
    } else if (!badge) {
      // The row lights up first, the verdict lands a beat later. Both at once reads as a
      // pre-baked answer; separated, it reads as Atlas arriving at one.
      t = setTimeout(() => setBadge(true), BADGE_MS);
    } else {
      t = setTimeout(() => {
        setShown(0);
        setMarked(false);
        setBadge(false);
      }, HOLD_MS);
    }
    return () => clearTimeout(t);
  }, [shown, marked, badge, reduced]);

  const visible = reduced ? STEPS.length : shown;
  const isMarked = reduced || marked;
  const showBadge = reduced || badge;

  return (
    <div className="relative">
      {/* The rail grows with the reveal, so the trace extends rather than sitting pre-drawn. */}
      <div
        className="absolute left-[102px] top-8 w-px bg-neutral-200 transition-[height] duration-500 ease-out"
        style={{ height: visible > 1 ? `${(visible - 1) * 68}px` : "0px" }}
        aria-hidden="true"
      />
      <ol className="space-y-1">
        {STEPS.map((r, i) => (
          <li
            key={r.title}
            className={cn(
              "flex items-start gap-4 transition-opacity duration-300",
              i < visible ? "opacity-100" : "opacity-0",
              i < visible &&
                "motion-safe:animate-[motion-rise_0.4s_cubic-bezier(0.2,0.8,0.2,1)_both]",
            )}
          >
            <span className="w-[70px] shrink-0 pt-[11px] text-right text-xs tabular-nums text-neutral-400">
              {r.time}
            </span>
            <span
              className={cn(
                "relative z-10 mt-1.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-white",
                r.alarm ? "border-danger/40 ring-4 ring-danger/10" : "border-neutral-200",
              )}
            >
              <CloudIcon name={r.icon} className="size-4" />
            </span>
            {/* items-center so the pill sits against the middle of the two-line block, not tacked
                onto the end of the title; ml-auto pushes it to the right edge of the row. */}
            <span
              className={cn(
                "relative flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors duration-500",
                r.culprit && isMarked ? "border-danger bg-danger/[0.04]" : "border-transparent",
              )}
            >
              {/* A single outward pulse on the moment of the find — the visual equivalent of
                  "…there it is". Fires once per loop, not continuously; a permanently throbbing
                  row would read as an unattended alarm rather than a conclusion. */}
              {r.culprit && isMarked ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-danger/50 motion-safe:animate-[trace-found_0.9s_ease-out_forwards]"
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.title}</span>
                <span className="mt-0.5 block text-xs text-neutral-500">{r.detail}</span>
              </span>
              {r.culprit && showBadge ? (
                <span className="shrink-0 rounded-full bg-danger px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white motion-safe:animate-[motion-pop_0.3s_cubic-bezier(0.2,0.8,0.2,1)_both]">
                  Most likely cause
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
