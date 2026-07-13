"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Shared motion primitives (paired with the CSS `.motion-*` utilities in globals.css).
 *
 * Use the CSS classes (`motion-rise`, `motion-fade`, `motion-pop`, `.motion-stagger`) for content
 * that animates **on mount** — they work in server components with zero JS and are the default.
 *
 * Use `<Reveal>` for content that should animate **when scrolled into view** (long/below-the-fold
 * lists) or when it appears after a client-side change. It starts hidden and transitions in the
 * first time it enters the viewport. `delay` (ms) staggers siblings. Reduced-motion → shown instantly.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function Reveal({
  children,
  className,
  delay = 0,
  y = 8,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger delay in ms. */
  delay?: number;
  /** Initial downward offset in px. */
  y?: number;
  once?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    if (reduced) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          if (once) io.disconnect();
        } else if (!once) {
          setShown(false);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, once]);

  return (
    <div
      ref={ref}
      className={cn(className)}
      style={
        reduced
          ? undefined
          : {
              opacity: shown ? 1 : 0,
              transform: shown ? "none" : `translateY(${y}px)`,
              transition: `opacity 0.45s cubic-bezier(0.2,0.8,0.2,1) ${delay}ms, transform 0.45s cubic-bezier(0.2,0.8,0.2,1) ${delay}ms`,
              willChange: "opacity, transform",
            }
      }
    >
      {children}
    </div>
  );
}
