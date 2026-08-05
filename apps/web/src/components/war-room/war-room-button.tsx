"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Radar, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openIncident, type Incident } from "@/lib/browser-api";

/**
 * "Open War Room" (docs/plans/war-room.md). Opens (or reuses) an incident for a node and navigates
 * to its War Room. Rendered wherever something is broken — a finding, a red map node, an alert.
 */
export function WarRoomButton({
  orgId,
  nodeId,
  trigger = "manual",
  variant = "default",
  className,
}: {
  orgId: string;
  nodeId: string;
  trigger?: Incident["trigger"];
  variant?: "default" | "outline";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function go() {
    setBusy(true);
    const incident = await openIncident(orgId, nodeId, trigger);
    if (incident) {
      router.push(`/war-room/${incident.id}`);
    } else {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} size="sm" disabled={busy} onClick={go} className={className}>
      {busy ? (
        <Loader2 className="mr-1.5 size-4 animate-spin" />
      ) : (
        <Radar className="mr-1.5 size-4" />
      )}
      Take to War Room
    </Button>
  );
}
