"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CloudIcon } from "@/components/cloud-icon";
import { KIND_LOGO } from "@/lib/kind-visual";

/**
 * Blast radius, played out: the source pulses, then impact reaches each dependent in turn, then the
 * count lands.
 *
 * A static list of three dependents states the answer but not the idea. The idea is PROPAGATION -
 * that touching one thing reaches others you weren't thinking about, one hop at a time - and that
 * only reads if it happens in front of you. The last dependent is in a different cloud and arrives
 * last on purpose: it's the one a person would have forgotten, and the demo should let you feel
 * that beat before naming it.
 *
 * The radar rings are the product's own `.animate-blast-pulse` (globals.css), the same treatment
 * the map uses when you focus a node's blast radius - so what the landing page shows and what you
 * see after signing in are literally the same animation.
 *
 * Reduced motion renders the settled state, which loses the drama but none of the information.
 */
interface Dep {
  name: string;
  kind: string;
  via: string;
  /** Called out because a cross-cloud dependency is the one nobody holds in their head. */
  offCloud?: boolean;
}

const SOURCE = { name: "orders-db", kind: "aws.rds.instance" };

const DEPS: Dep[] = [
  { name: "checkout", kind: "aws.ecs.service", via: "writes on every order" },
  { name: "orders-webhook", kind: "aws.lambda.function", via: "writes on every event" },
  { name: "reports-renderer", kind: "gcp.run.service", via: "reads nightly", offCloud: true },
];

const PULSE_MS = 620;
const HIT_MS = 520;
const HOLD_MS = 3200;

export function BlastDemo() {
  const [hit, setHit] = useState(0);
  const [settled, setSettled] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let t: ReturnType<typeof setTimeout>;
    if (hit < DEPS.length) {
      t = setTimeout(() => setHit((n) => n + 1), hit === 0 ? PULSE_MS : HIT_MS);
    } else if (!settled) {
      t = setTimeout(() => setSettled(true), 420);
    } else {
      t = setTimeout(() => {
        setHit(0);
        setSettled(false);
      }, HOLD_MS);
    }
    return () => clearTimeout(t);
  }, [hit, settled, reduced]);

  const reached = reduced ? DEPS.length : hit;
  const done = reduced || settled;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6">
      <p className="text-sm text-neutral-400">
        What breaks if I retire <span className="font-medium text-neutral-700">{SOURCE.name}</span>?
      </p>

      {/* Source, sitting at the centre of a radar. The rings are the map's own blast-radius pulse,
          so "if this changes, it reaches these" reads before a word is processed. */}
      <div className="relative mt-5 flex items-center gap-3">
        <span className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-neutral-200 bg-white">
          {!reduced
            ? [0, 1, 2].map((r) => (
                <span
                  key={r}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-1/2 size-40 rounded-full border border-danger/40 animate-blast-pulse"
                  style={{ animationDelay: `${r * 1.1}s` }}
                />
              ))
            : null}
          <CloudIcon name={KIND_LOGO[SOURCE.kind] as string} className="relative size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{SOURCE.name}</span>
          <span className="block text-xs text-neutral-500">the thing you want to change</span>
        </span>
      </div>

      {/* The rail impact travels down, drawn only as far as it has reached. */}
      <div className="relative mt-3 pl-[18px]">
        <div
          aria-hidden="true"
          className="absolute left-[18px] top-0 w-px bg-danger/25 transition-[height] duration-500 ease-out"
          style={{ height: reached === 0 ? 0 : `${(reached - 1) * 62 + 30}px` }}
        />
        <div className="space-y-2.5 pl-6">
          {DEPS.map((d, i) => {
            const on = i < reached;
            return (
              <div
                key={d.name}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all duration-300",
                  on
                    ? "border-danger/30 bg-danger/[0.03] opacity-100"
                    : "border-neutral-200 opacity-35",
                )}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-neutral-100">
                  <CloudIcon name={KIND_LOGO[d.kind] as string} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.name}</span>
                  <span className="block truncate text-xs text-neutral-500">{d.via}</span>
                </span>
                {d.offCloud && on ? (
                  <span className="shrink-0 rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white motion-safe:animate-[motion-pop_0.3s_cubic-bezier(0.2,0.8,0.2,1)_both]">
                    Different cloud
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <p
        className={cn(
          "mt-4 border-t border-neutral-100 pt-4 text-xs transition-colors duration-300",
          done ? "text-neutral-500" : "text-neutral-300",
        )}
      >
        {done
          ? "3 direct dependents, across 2 clouds. Nothing else in the graph touches it."
          : "Tracing dependents…"}
      </p>
    </div>
  );
}
