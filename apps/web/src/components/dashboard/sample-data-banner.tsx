"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearDemo } from "@/lib/browser-api";

/**
 * Shown on the dashboard when the estate is the seeded sample data (demo connections only, no real
 * source). Gives a one-click way back to a clean slate — the counterpart to onboarding's "Load
 * sample data" — so a user isn't stuck exploring demo data with no obvious way to clear it. Only
 * rendered for Admins/Owners (the API DELETE /demo is Admin-gated).
 */
export function SampleDataBanner({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await clearDemo(orgId);
      // The dashboard is a server component — refresh re-renders it (now empty → onboarding).
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t clear the sample data.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
      <div className="flex items-center gap-2.5 text-sm">
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <span>
          <span className="font-medium">You&rsquo;re exploring sample data.</span>{" "}
          <span className="text-muted-foreground">
            A demo estate built through the real pipeline - clear it anytime to connect your own.
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        {error ? <span className="text-xs text-danger">{error}</span> : null}
        <Button size="sm" variant="outline" onClick={() => void clear()} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Clearing…
            </>
          ) : (
            <>
              <Trash2 className="size-3.5" /> Clear sample data
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
