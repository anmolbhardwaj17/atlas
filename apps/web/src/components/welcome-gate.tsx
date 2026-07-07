"use client";

import * as React from "react";
import { WelcomeOverlay } from "@/components/welcome-overlay";

/**
 * Shows the WelcomeOverlay exactly once, right after sign-in. The auth callback drops a
 * short-lived `atlas_welcome` cookie; we read it on first mount, immediately delete it (so a
 * reload or return visit never re-triggers), and play the greeting. No cookie → nothing renders.
 */
export function WelcomeGate({ name }: { name?: string | null }) {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    const has = document.cookie.split("; ").some((c) => c === "atlas_welcome=1");
    if (has) {
      document.cookie = "atlas_welcome=; path=/; max-age=0"; // consume it
      setShow(true);
    }
  }, []);

  if (!show) return null;
  return <WelcomeOverlay name={name} onDone={() => setShow(false)} />;
}
