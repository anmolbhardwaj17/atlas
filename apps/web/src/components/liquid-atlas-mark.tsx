"use client";

import * as React from "react";
import dynamic from "next/dynamic";

/**
 * The Atlas mark rendered with Paper's liquid-metal shader — mirrors the login page's config, but
 * the metal tint adapts to the theme: a mid grey reads well on the white login page / light mode,
 * while dark mode needs a brighter, cooler tint so the mark doesn't turn into a muddy dark blob.
 * WebGL, so it's loaded client-only via next/dynamic (ssr:false). Motion is the liquid flow (no spin).
 */
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false, loading: () => <div className="size-full" /> },
);

/** Whether the app is in dark mode (the `dark` class on <html>), reactive to theme toggles. */
function useIsDark(): boolean {
  const [dark, setDark] = React.useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  React.useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function LiquidAtlasMark({ size = 132 }: { size?: number }) {
  const dark = useIsDark();
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
        colorTint={dark ? "#d7e0ee" : "#999999"}
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
