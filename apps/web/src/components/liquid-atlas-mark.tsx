"use client";

import dynamic from "next/dynamic";

/**
 * The Atlas mark rendered with Paper's liquid-metal shader (a flowing metallic material over the
 * logo's shape). WebGL, so it's loaded client-only via next/dynamic (ssr:false) with a plain-logo
 * fallback while the shader chunk downloads. No rotation — the motion is the liquid flow itself.
 */
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  {
    ssr: false,
    loading: () => <span className="block size-full animate-pulse rounded-2xl bg-muted" />,
  },
);

export function LiquidAtlasMark({ size = 64 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="shrink-0">
      <LiquidMetal
        image="/atlas-logo.png"
        width={size}
        height={size}
        // Gentle liquid flow — this is the motion; the old spin is gone.
        speed={0.5}
        colorBack="rgba(0,0,0,0)"
        colorTint="#9aa4b2"
        repetition={4}
        softness={0.4}
        shiftRed={0.3}
        shiftBlue={0.3}
        contour={1}
        distortion={0.12}
        angle={0}
      />
    </div>
  );
}
