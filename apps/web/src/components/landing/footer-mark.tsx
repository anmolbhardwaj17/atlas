"use client";

import dynamic from "next/dynamic";

// WebGL shader - client-only and lazy. In the footer it is genuinely below the fold, so it costs
// nothing on first paint and loads while the visitor is still reading the page above it.
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false, loading: () => null },
);

/**
 * The liquid-metal Atlas mark, sitting in the footer as the page's sign-off.
 *
 * Same shader, tint and distortion as the sign-in screen - a visitor moves between the two in one
 * click, and a mark that changes character between them reads as two different products.
 *
 * The hero was the wrong home for it: at that size it competed with the headline for the one thing
 * the top of the page has to do, and a heavy ornament beside "Nobody knows how the whole system
 * fits together" undercut the line rather than supported it. Down here it does what a colophon
 * does - the last thing you see, unhurried, with nothing to compete against.
 *
 * `aria-hidden` and `pointer-events-none`: it carries no information and must never intercept a
 * click meant for a footer link.
 */
export function FooterMark() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -bottom-24 right-0 hidden translate-x-1/4 select-none opacity-90 md:block"
    >
      <LiquidMetal
        width={360}
        height={360}
        image="/atlas-logo.png"
        colorBack="#00000000"
        colorTint="#999999"
        repetition={2}
        softness={0.1}
        shiftRed={0.3}
        shiftBlue={0.3}
        distortion={0.07}
        contour={0.4}
        angle={70}
        speed={1}
        scale={0.82}
        fit="contain"
      />
    </div>
  );
}
