"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { countOpenIncidents } from "@/lib/browser-api";

/**
 * Live incident count on the War Room nav item.
 *
 * The one number in the product that is worth interrupting someone for. Without it, "is anything
 * on fire right now?" is only answerable by navigating to War Room and looking — so the page that
 * matters most is the one you have to remember to check. The badge inverts that: the nav tells you
 * when to go, and stays silent otherwise.
 *
 * Renders NOTHING at zero — deliberately. A permanent "0" badge is visual noise that trains people
 * to stop reading the number, which costs exactly the glance the badge exists to buy. Same rule the
 * suggested-links nudge follows.
 *
 * Cheap on purpose: one indexed query a minute, and it re-checks on navigation so acting on an
 * incident updates the badge without waiting out the interval.
 */
const POLL_MS = 60_000;

export function WarRoomCount({ orgId }: { orgId: string }) {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const n = await countOpenIncidents(orgId);
        if (!cancelled) setCount(n);
      } catch {
        /* offline or mid-deploy — keep the last known value rather than flashing to zero */
      }
    }

    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // pathname: re-check on navigation, so resolving an incident clears the badge immediately.
  }, [orgId, pathname]);

  if (count === 0) return null;
  return (
    <span
      className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold tabular-nums text-white group-data-[collapsible=icon]:hidden"
      title={`${count} active ${count === 1 ? "incident" : "incidents"}`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
