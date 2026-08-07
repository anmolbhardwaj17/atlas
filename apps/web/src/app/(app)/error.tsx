"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";

/**
 * In-shell error boundary for the authenticated app. A thrown error in any page (a failed data load,
 * a client render crash) renders here — inside the sidebar shell, on-brand (the ErrorState mark) —
 * instead of escaping to the root `global-error`, which replaces the whole document off-theme.
 * `reset()` re-attempts the failed segment (re-runs the server component / re-mounts the client tree).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server-side error carries the correlation id in its logs; this surfaces it in the console.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <ErrorState
        title="Couldn’t load this page"
        description="Something went wrong on our end - this is usually temporary. Try again, or refresh."
        actions={
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
