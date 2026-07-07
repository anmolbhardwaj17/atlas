"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { AtlasAiMark } from "@/components/brand";

/**
 * A one-shot welcome that greets you on the way into the app, then dismisses itself. It sits on a
 * blurred backdrop and, on exit, both the blur and the card fade away to smoothly reveal the page
 * behind (e.g. the dashboard). Purely presentational + self-timing; the parent unmounts it via
 * `onDone`.
 */
export function WelcomeOverlay({
  name,
  onDone,
  holdMs = 2400,
}: {
  name?: string | null;
  onDone?: () => void;
  /** How long the greeting stays fully visible before it starts revealing the page. */
  holdMs?: number;
}) {
  const [entered, setEntered] = React.useState(false);
  const [leaving, setLeaving] = React.useState(false);

  React.useEffect(() => {
    const t0 = setTimeout(() => setEntered(true), 20); // trigger the enter transition
    const t1 = setTimeout(() => setLeaving(true), holdMs); // begin the reveal
    const t2 = setTimeout(() => onDone?.(), holdMs + 750); // unmount after the reveal finishes
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [holdMs, onDone]);

  const active = entered && !leaving;
  const firstName = name?.trim().split(/\s+/)[0];

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center transition-all duration-700 ease-out",
        active
          ? "bg-background/40 opacity-100 backdrop-blur-xl"
          : "pointer-events-none bg-background/0 opacity-0 backdrop-blur-0",
      )}
      aria-live="polite"
    >
      <div
        className={cn(
          "flex flex-col items-center rounded-2xl border border-border bg-card px-10 py-9 text-center shadow-2xl transition-all duration-500 ease-out",
          active ? "translate-y-0 scale-100 opacity-100" : "translate-y-2 scale-95 opacity-0",
        )}
      >
        {/* Brand mark with a soft green glow. */}
        <div className="relative mb-4 grid size-16 place-items-center">
          <span
            aria-hidden
            className="absolute size-16 rounded-full bg-[#70ff7a] opacity-30 blur-2xl"
          />
          <AtlasAiMark size={56} className="size-14 drop-shadow" />
        </div>

        <h2 className="text-xl font-semibold tracking-tight">
          {firstName ? `Welcome, ${firstName}` : "Welcome to Atlas"}
        </h2>
        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
          Your workspace is ready. Taking you in…
        </p>
      </div>
    </div>
  );
}
