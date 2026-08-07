"use client";

import { useEffect, useReducer, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { AtlasAiMark } from "@/components/brand";
import { CloudIcon } from "@/components/cloud-icon";
import { KIND_LOGO, kindShort } from "@/lib/kind-visual";

/**
 * A looping Atlas AI demo, shaped like the real Ask surface: the question types itself into the
 * composer at the bottom, sends, appears as a message, Atlas thinks, then the answer streams in and
 * its citations land underneath.
 *
 * A static screenshot can show the answer FORMAT but not the thing that matters — that you ask in
 * plain language and get something sourced back. Running it in the product's own chat shape means
 * the demo shows the actual interaction rather than an illustration of it, and the pause before the
 * answer is honest: the product searches a graph, it doesn't autocomplete.
 *
 * Light panel on a dark card: this is the surface you'd type into, and every input in the product
 * is light. Matching it keeps the demo reading as a piece of the app rather than as artwork.
 *
 * Four questions chosen for range, not repetition — a dependency lookup, a change correlation, an
 * exposure question, a blast-radius question. The last deliberately ends in a partial answer: Atlas
 * naming what it CAN'T see is the differentiator, and a demo where the agent is omniscient four
 * times out of four quietly promises something the product won't deliver.
 *
 * Reduced motion is a first-class path: the loop is skipped and one finished exchange renders still.
 */
type Part = { t: string } | { b: string } | { c: number };

interface Exchange {
  q: string;
  parts: Part[];
  cites: string[];
}

const EXCHANGES: Exchange[] = [
  {
    q: "What talks to orders-db, and who owns it?",
    parts: [
      { t: "Two services write to " },
      { b: "orders-db" },
      { t: ": the " },
      { b: "checkout" },
      { t: " ECS service" },
      { c: 1 },
      { t: " and the " },
      { b: "orders-webhook" },
      { t: " Lambda" },
      { c: 2 },
      { t: ". The repository behind both is owned by " },
      { b: "@payments" },
      { c: 3 },
      { t: " — five people." },
    ],
    cites: ["aws.rds.instance", "aws.lambda.function", "bitbucket.repository"],
  },
  {
    q: "What changed before the 2am spike?",
    parts: [
      { b: "deploy-production" },
      { t: " ran at 01:46" },
      { c: 1 },
      { t: ", fourteen minutes before the alarm. It shipped " },
      { b: "PR #1482" },
      { c: 2 },
      { t: " — “retry budget for orders-db” — the only change touching " },
      { b: "checkout" },
      { c: 3 },
      { t: " in that window." },
    ],
    cites: ["bitbucket.pipeline", "bitbucket.repository", "aws.ecs.service"],
  },
  {
    q: "Which services are reachable from the internet?",
    parts: [
      { t: "One: " },
      { b: "checkout" },
      { c: 1 },
      { t: ", through " },
      { b: "checkout-alb" },
      { c: 2 },
      { t: ", which " },
      { b: "api.acme.com" },
      { c: 3 },
      { t: " resolves to. Nothing else has a world-open path." },
    ],
    cites: ["aws.ecs.service", "aws.elb", "aws.route53.record"],
  },
  {
    q: "What breaks if I retire checkout-assets?",
    parts: [
      { b: "checkout" },
      { c: 1 },
      {
        t: " reads from it on every render. Nothing else in the graph references it — though I can't see inside container images, so a hard-coded URL wouldn't show up here.",
      },
    ],
    cites: ["aws.s3.bucket", "aws.ecs.service"],
  },
];

/** Plain length of an answer, for driving the streaming reveal. */
const partsLength = (parts: Part[]): number =>
  parts.reduce((n, p) => n + ("t" in p ? p.t.length : "b" in p ? p.b.length : 1), 0);

type Phase = "typing" | "sending" | "thinking" | "streaming" | "holding";

interface State {
  i: number;
  phase: Phase;
  typed: number;
  streamed: number;
}

type Action =
  { type: "tick" } | { type: "stream" } | { type: "phase"; phase: Phase } | { type: "next" };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "tick":
      return { ...s, typed: s.typed + 1 };
    case "stream":
      return { ...s, streamed: s.streamed + 3 };
    case "phase":
      return { ...s, phase: a.phase };
    case "next":
      return { i: (s.i + 1) % EXCHANGES.length, phase: "typing", typed: 0, streamed: 0 };
  }
}

// Pacing. The hold after an answer was the dead spot — long enough to read the answer twice and
// then wait. It only needs to outlast one comfortable read of the longest answer; past that the
// loop reads as stalled rather than as considered. The beats around it are trimmed to match.
const TYPE_MS = 28;
const SENT_PAUSE_MS = 200;
const SEND_MS = 240;
const THINK_MS = 850;
const STREAM_MS = 14;
const SETTLE_MS = 280;
const HOLD_MS = 2100;

/** The steps Atlas shows while working — the same shape the product's diagnose trace uses. */
const THINKING_STEPS = ["Searching the graph", "Reading 3 resources", "Checking provenance"];

export function AskDemo() {
  const [s, dispatch] = useReducer(reducer, { i: 0, phase: "typing", typed: 0, streamed: 0 });
  const ex = EXCHANGES[s.i] as Exchange;
  const answerLen = partsLength(ex.parts);

  // Motion preference is read in an effect, never during render: the server has no `window`, so
  // deriving it inline would render one thing on the server and possibly another on the client.
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let t: ReturnType<typeof setTimeout>;
    if (s.phase === "typing") {
      t =
        s.typed < ex.q.length
          ? setTimeout(() => dispatch({ type: "tick" }), TYPE_MS)
          : setTimeout(() => dispatch({ type: "phase", phase: "sending" }), SENT_PAUSE_MS);
    } else if (s.phase === "sending") {
      t = setTimeout(() => dispatch({ type: "phase", phase: "thinking" }), SEND_MS);
    } else if (s.phase === "thinking") {
      t = setTimeout(() => dispatch({ type: "phase", phase: "streaming" }), THINK_MS);
    } else if (s.phase === "streaming") {
      t =
        s.streamed < answerLen
          ? setTimeout(() => dispatch({ type: "stream" }), STREAM_MS)
          : setTimeout(() => dispatch({ type: "phase", phase: "holding" }), SETTLE_MS);
    } else {
      t = setTimeout(() => dispatch({ type: "next" }), HOLD_MS);
    }
    return () => clearTimeout(t);
  }, [s.phase, s.typed, s.streamed, s.i, ex.q.length, answerLen, reduced]);

  const sent = reduced || s.phase !== "typing";
  const thinking = !reduced && (s.phase === "sending" || s.phase === "thinking");
  const answering = reduced || s.phase === "streaming" || s.phase === "holding";
  const shown = reduced ? answerLen : s.streamed;
  const done = reduced || s.streamed >= answerLen;

  // Reveal the answer character-by-character across its parts, so entities and citations arrive
  // mid-sentence exactly as they do when a real answer streams.
  let cursor = 0;
  const rendered = ex.parts.map((p, idx) => {
    const len = "t" in p ? p.t.length : "b" in p ? p.b.length : 1;
    const start = cursor;
    cursor += len;
    if (shown <= start) return null;
    const take = Math.min(len, shown - start);
    if ("t" in p) return <span key={idx}>{p.t.slice(0, take)}</span>;
    if ("b" in p)
      return (
        <span key={idx} className="font-medium text-neutral-900">
          {p.b.slice(0, take)}
        </span>
      );
    return (
      <sup
        key={idx}
        className="ml-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-sm bg-neutral-900/10 px-1 align-super text-[9px] font-semibold text-neutral-600"
      >
        {p.c}
      </sup>
    );
  });

  return (
    <div className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-lg">
      {/* Conversation */}
      <div className="flex-1 space-y-4 p-5">
        {sent ? (
          <div className="flex justify-end motion-safe:animate-[motion-rise_0.3s_cubic-bezier(0.2,0.8,0.2,1)_both]">
            <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-900 px-3.5 py-2 text-sm text-white">
              {ex.q}
            </p>
          </div>
        ) : null}

        {thinking ? (
          <div className="flex gap-3 motion-safe:animate-[motion-fade_0.3s_ease-out_both]">
            <AtlasAiMark size={22} className="mt-0.5 size-[22px] shrink-0 animate-ai-pulse" />
            <div className="space-y-1.5 pt-0.5">
              {THINKING_STEPS.map((step, i) => (
                <p
                  key={step}
                  className="text-xs text-neutral-400 motion-safe:animate-[motion-fade_0.3s_ease-out_both]"
                  style={{ animationDelay: `${i * 220}ms` }}
                >
                  {step}…
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {answering ? (
          <div className="flex gap-3">
            <AtlasAiMark size={22} className="mt-0.5 size-[22px] shrink-0" />
            <div className="min-w-0">
              <p className="text-sm leading-relaxed text-neutral-600">
                {rendered}
                {!done ? (
                  <span className="ml-0.5 inline-block h-[1em] w-px translate-y-[2px] animate-pulse bg-neutral-400" />
                ) : null}
              </p>
              {done ? (
                <div className="mt-3.5 flex flex-wrap gap-1.5 motion-safe:animate-[motion-rise_0.35s_cubic-bezier(0.2,0.8,0.2,1)_both]">
                  {ex.cites.map((k, i) => (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600"
                    >
                      <span className="text-neutral-400">{i + 1}</span>
                      <CloudIcon name={KIND_LOGO[k] as string} className="size-3.5" />
                      {kindShort(k)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Composer — where the question types itself before it is sent. */}
      <div className="border-t border-neutral-200 p-4">
        <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-2.5">
          <p className="min-w-0 flex-1 truncate text-sm text-neutral-700">
            {sent ? (
              <span className="text-neutral-400">Ask a follow-up…</span>
            ) : (
              <>
                {ex.q.slice(0, s.typed)}
                <span className="ml-px inline-block h-[1.05em] w-px translate-y-[3px] animate-pulse bg-neutral-500" />
              </>
            )}
          </p>
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
              sent ? "bg-neutral-200 text-neutral-400" : "bg-neutral-900 text-white",
            )}
          >
            <ArrowUp className="size-4" />
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-neutral-400">
            Ask from the app, or from Slack without leaving the channel.
          </p>
          <span className="flex gap-1.5" aria-hidden="true">
            {EXCHANGES.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "size-1 rounded-full transition-colors",
                  i === s.i ? "bg-neutral-500" : "bg-neutral-300",
                )}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
