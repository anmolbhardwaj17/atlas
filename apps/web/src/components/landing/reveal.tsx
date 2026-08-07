"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Reveal content when it scrolls into view.
 *
 * The app's motion vocabulary (globals.css) covers "content arriving" on mount — `.motion-rise`,
 * `.motion-fade`, `.motion-pop` — which is all an authenticated page needs, because it renders one
 * screenful at a time. A landing page is read by scrolling, so entrances have to be tied to the
 * viewport instead of to mount.
 *
 * This applies the SAME keyframes rather than introducing a second motion language, and does it
 * with an IntersectionObserver instead of an animation library: the whole behaviour is ~30 lines,
 * and pulling in GSAP to move things 8px would put more JavaScript on the marketing page than on
 * the product.
 *
 * Reduced motion is handled for free — the `.motion-*` classes are inert outside
 * `prefers-reduced-motion: no-preference`, so those users get the final state with no animation and
 * no flash of hidden content. That is also why the pre-reveal state is `opacity-0` applied ONLY
 * once we know the observer is running (`armed`): if JS never loads, or the browser has no
 * IntersectionObserver, the content stays visible instead of being permanently invisible.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  variant = "rise",
}: {
  children: ReactNode;
  className?: string;
  /** Stagger in ms — for sibling cards that should arrive in sequence rather than together. */
  delay?: number;
  variant?: "rise" | "fade" | "pop";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    setArmed(true);

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          setShown(true);
          io.disconnect(); // One-shot: re-animating on every scroll-by is nausea, not delight.
        }
      },
      // Fire slightly before the element is fully on screen so the motion reads as the page
      // responding to you, rather than as content that was caught being late.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(armed && !shown && "opacity-0", shown && `motion-${variant}`, className)}
      style={shown && delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
