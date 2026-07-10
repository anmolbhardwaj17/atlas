"use client";

import dynamic from "next/dynamic";

/**
 * The Atlas mark rendered with Paper's liquid-metal shader — the SAME configuration used on the
 * login page (`app/login/page.tsx`), so the brand mark is identical across sign-in and onboarding.
 * WebGL, so it's loaded client-only via next/dynamic (ssr:false). The motion is the liquid flow
 * itself (no spin).
 */
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false, loading: () => <div className="size-full" /> },
);

export function LiquidAtlasMark({ size = 132 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="[filter:drop-shadow(0_14px_34px_rgba(0,0,0,0.12))]"
    >
      <LiquidMetal
        width={size}
        height={size}
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
