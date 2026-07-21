"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getSuggestedEdges } from "@/lib/browser-api";
import { AI_SUGGESTED_COLOR } from "@/lib/map-types";

/**
 * Discoverability nudge for AI-suggested links, shown on the dashboard's map card.
 * Pending suggestions are otherwise only findable inside the map (the review panel / dotted
 * edges), so a user who never opens the map never learns Atlas has proposals waiting. This
 * fetches the pending count client-side and, ONLY when there are any, renders a subtle pill
 * linking straight to the map. It renders nothing while loading or at zero, so the card is
 * unchanged in the common (no-pending) case.
 */
export function SuggestedLinksNudge({ orgId }: { orgId: string }) {
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    void getSuggestedEdges(orgId)
      .then((edges) => {
        if (alive) setCount(edges.length);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [orgId]);

  if (count === 0) return null;

  return (
    <Link
      href="/map"
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
      style={{
        borderColor: `${AI_SUGGESTED_COLOR}66`,
        background: `${AI_SUGGESTED_COLOR}12`,
        color: AI_SUGGESTED_COLOR,
      }}
      title="Atlas has proposed links waiting for your review"
    >
      <Sparkles className="size-3.5" />
      {count} AI-suggested link{count === 1 ? "" : "s"} to review
    </Link>
  );
}
