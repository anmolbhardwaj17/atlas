"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { WelcomeOverlay } from "@/components/welcome-overlay";

/**
 * TEST TRIGGER (temporary) — a navbar button that replays the first-time {@link WelcomeOverlay} (the
 * green-blob glow greeting normally shown once after Google auth) on demand, so we can preview and
 * iterate on that overlay without re-authing each time. Edit the overlay, click this, watch it play.
 * Once the treatment is dialed in, this button comes back out and the change lands in WelcomeOverlay.
 */
export function WelcomePreviewButton({ name }: { name?: string | null | undefined }) {
  const [playing, setPlaying] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setPlaying(true)}
        className="hidden items-center gap-1.5 rounded-full border border-border bg-card/70 py-1 pl-2 pr-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground md:flex"
        title="Preview the first-time welcome animation"
      >
        <Sparkles className="size-3.5 text-emerald-500" />
        Preview welcome
      </button>
      {playing ? <WelcomeOverlay name={name} onDone={() => setPlaying(false)} /> : null}
    </>
  );
}
