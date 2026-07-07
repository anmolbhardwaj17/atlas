"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { AtlasLogo } from "@/components/brand";

/**
 * A one-shot welcome that greets you on the way into the app, then dismisses itself. The
 * background blur eases in first; the green blob + greeting fade in over it; then everything
 * (blur, blob, text) fades out together to smoothly reveal the page behind. Self-timing; the
 * parent unmounts it via `onDone`.
 */
export function WelcomeOverlay({
  name,
  onDone,
  holdMs = 3500,
}: {
  name?: string | null;
  onDone?: () => void;
  /** How long the greeting stays fully visible before it starts revealing the page. */
  holdMs?: number;
}) {
  const [blurIn, setBlurIn] = React.useState(false);
  const [contentIn, setContentIn] = React.useState(false);

  React.useEffect(() => {
    const t0 = setTimeout(() => setBlurIn(true), 20); // blur eases in first
    const t1 = setTimeout(() => setContentIn(true), 450); // then the blob + greeting
    const t2 = setTimeout(() => {
      // fade everything out together
      setContentIn(false);
      setBlurIn(false);
    }, holdMs);
    const t3 = setTimeout(() => onDone?.(), holdMs + 750); // unmount after the reveal
    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [holdMs, onDone]);

  const firstName = name?.trim().split(/\s+/)[0];

  // Blur strongest at the center, fading to none at the edges (Chrome-friendly; -webkit for Safari).
  const CENTER_FADE = "radial-gradient(circle at center, black 0%, black 46%, transparent 86%)";

  return (
    <div
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center",
        blurIn ? "" : "pointer-events-none",
      )}
      aria-live="polite"
    >
      {/* 1) Center-focused gaussian blur - eases in first. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 backdrop-blur-3xl transition-opacity duration-700 ease-out",
          blurIn ? "opacity-100" : "opacity-0",
        )}
        style={{ WebkitMaskImage: CENTER_FADE, maskImage: CENTER_FADE }}
      />

      {/* 2) Two organic green blobs orbiting the center as the wrapper rotates - fade in after the
             blur, and heavily blurred so they read as a soft living light. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-700 ease-out",
          contentIn ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="absolute inset-0 m-auto size-[700px] motion-safe:animate-[spin_13s_linear_infinite]">
          {/* Greens sampled straight from the Atlas AI logo gradient. */}
          <div className="absolute left-1/2 top-1/2 size-[440px] -translate-x-[64%] -translate-y-[58%] rounded-[46%_54%_63%_37%/52%_44%_56%_48%] bg-[#55b073] blur-[80px]" />
          <div className="absolute left-1/2 top-1/2 size-[440px] -translate-x-[36%] -translate-y-[42%] rounded-[58%_42%_45%_55%/48%_57%_43%_52%] bg-[#247e54] blur-[80px]" />
        </div>
      </div>

      {/* 3) The greeting - fades in with the blob, out with everything else. */}
      <div
        className={cn(
          "relative flex flex-col items-center text-center transition-all duration-700 ease-out",
          contentIn ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-95 opacity-0",
        )}
      >
        <div className="mb-6 grid place-items-center">
          <AtlasLogo
            size={96}
            className="size-24 [filter:invert(1)_drop-shadow(0_6px_18px_rgba(0,0,0,0.4))]"
          />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-white [text-shadow:0_2px_16px_rgba(0,0,0,0.35)]">
          {firstName ? `Welcome, ${firstName}` : "Welcome to Atlas"}
        </h2>
        <p className="mt-2 max-w-xs text-sm text-white/80 [text-shadow:0_2px_16px_rgba(0,0,0,0.3)]">
          Your workspace is ready. Taking you in…
        </p>
      </div>
    </div>
  );
}
