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
  name?: string | null | undefined;
  onDone?: (() => void) | undefined;
  /** How long the greeting stays fully visible before it starts revealing the page. */
  holdMs?: number | undefined;
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

      {/* 2) A "living light" that traces the Atlas AI sphere's own gradient - a warm cream-lit
             highlight on the upper-right, easing through spring-green into a deep teal-green shadow
             on the lower-left - orbiting as the wrapper rotates. Three heavily-blurred, layered
             tones (not one flat green) give it the sphere's depth; fades in after the blur. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-700 ease-out",
          contentIn ? "opacity-100" : "opacity-0",
        )}
      >
        {/* Orbiting logo-gradient tones (behind). Translucent (rgba, not solid hex) so they read as
            coloured LIGHT rather than paint - the middle stays airy instead of a dense green fill. */}
        <div className="absolute inset-0 m-auto size-[780px] motion-safe:animate-[spin_18s_linear_infinite]">
          {/* Lit side: warm yellow-cream highlight melting into spring green (the sphere's top-right). */}
          <div
            className="absolute left-1/2 top-1/2 size-[440px] -translate-x-[28%] -translate-y-[66%] rounded-[46%_54%_63%_37%/52%_44%_56%_48%] blur-[92px]"
            style={{
              background:
                "radial-gradient(circle at 50% 46%, rgba(245,230,140,0.80) 0%, rgba(150,213,158,0.48) 54%, transparent 100%)",
            }}
          />
          {/* Spring-green mid - the core tone of the mark, held below full opacity. */}
          <div
            className="absolute left-1/2 top-1/2 size-[450px] -translate-x-[58%] -translate-y-[40%] rounded-[58%_42%_45%_55%/48%_57%_43%_52%] blur-[92px]"
            style={{
              background:
                "radial-gradient(circle, rgba(79,182,132,0.62) 0%, rgba(79,182,132,0.30) 60%, transparent 100%)",
            }}
          />
          {/* Shadow side: deep teal-green (the sphere's lower-left) - weight, and holds colour on a
              light background instead of washing out. */}
          <div
            className="absolute left-1/2 top-1/2 size-[430px] -translate-x-[72%] -translate-y-[26%] rounded-[52%_48%_57%_43%/55%_49%_51%_45%] blur-[96px]"
            style={{
              background: "radial-gradient(circle, rgba(36,138,98,0.55) 0%, transparent 72%)",
            }}
          />
        </div>
        {/* Luminous warm centre (front) - a bright, translucent yellow-cream core so the middle
            GLOWS and stays see-through instead of a solid green fill, and carries the mark's yellow
            hint. Kept gentle so the white logo + greeting keep their contrast in both themes. */}
        <div
          className="absolute inset-0 m-auto size-[560px] blur-[66px]"
          style={{
            background:
              "radial-gradient(circle at 50% 48%, rgba(255,248,214,0.45) 0%, rgba(226,226,150,0.28) 27%, rgba(126,203,156,0.14) 54%, transparent 78%)",
          }}
        />
      </div>

      {/* 3) The greeting - fades in with the blob, out with everything else. */}
      <div
        className={cn(
          "relative flex flex-col items-center text-center transition-all duration-700 ease-out",
          contentIn ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-95 opacity-0",
        )}
      >
        <div className="mb-3 grid place-items-center">
          <AtlasLogo
            size={96}
            className="size-24 [filter:invert(1)_drop-shadow(0_6px_18px_rgba(0,0,0,0.4))]"
          />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-white [text-shadow:0_2px_16px_rgba(0,0,0,0.35)]">
          {firstName ? `Hey ${firstName}!` : "Welcome to Atlas"}
        </h2>
        <p className="mt-2 max-w-xs text-sm text-white/80 [text-shadow:0_2px_16px_rgba(0,0,0,0.3)]">
          Your organization is ready. Taking you in…
        </p>
      </div>
    </div>
  );
}
