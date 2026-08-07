"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellOff, Bell, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  listConnections,
  triggerSync,
  getActiveFindingIds,
  muteFinding,
  unmuteFinding,
} from "@/lib/browser-api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lifecycle actions for a finding. Findings are derived live, so:
 *  - "Recheck / I fixed it" re-syncs the connected sources, then confirms whether this finding
 *    actually cleared (honest, from the fresh graph) - not a manual "fixed" flag that could lie.
 *  - "Mute / accept risk" persists a human decision to dismiss it (reversible).
 */
export function FindingActions({
  orgId,
  findingId,
  muted: initialMuted,
}: {
  orgId: string;
  findingId: string;
  muted: boolean;
}) {
  const router = useRouter();
  const [muted, setMuted] = React.useState(initialMuted);
  const [busy, setBusy] = React.useState<"mute" | "recheck" | null>(null);

  async function toggleMute() {
    setBusy("mute");
    try {
      if (muted) {
        await unmuteFinding(orgId, findingId);
        setMuted(false);
        toast.success("Unmuted", { description: "It’s back in your active findings." });
      } else {
        await muteFinding(orgId, findingId);
        setMuted(true);
        toast.success("Muted", { description: "Accepted as a known risk. You can undo this." });
      }
      router.refresh();
    } catch (e) {
      toast.error("Couldn’t update", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function recheck() {
    setBusy("recheck");
    const t = toast.loading("Rechecking…", {
      description: "Re-syncing your sources to confirm this from the live graph.",
    });
    try {
      const conns = await listConnections(orgId);
      const syncable = conns.filter(
        (c) => !c.demo && (c.status === "connected" || c.status === "degraded"),
      );
      if (syncable.length === 0) {
        toast.error("Nothing to recheck", {
          id: t,
          description: "No connected sources to re-sync.",
        });
        return;
      }
      await Promise.all(syncable.map((c) => triggerSync(orgId, c.id).catch(() => undefined)));

      // Wait for the syncs to finish (bounded), then confirm against the fresh graph.
      const deadline = Date.now() + 90_000;
      let syncing = true;
      while (syncing && Date.now() < deadline) {
        await sleep(4_000);
        const now = await listConnections(orgId);
        syncing = now.some((c) => c.syncing);
      }

      const stillActive = (await getActiveFindingIds(orgId)).includes(findingId);
      if (!stillActive) {
        toast.success("Fixed - it cleared.", {
          id: t,
          description: "This finding is no longer flagged in your latest graph.",
        });
        router.push("/insights");
      } else {
        toast.warning("Still detected", {
          id: t,
          description: "Atlas re-synced, but this is still flagged. Not fixed yet.",
        });
        router.refresh();
      }
    } catch (e) {
      toast.error("Recheck failed", {
        id: t,
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Recheck = the positive "I fixed it" action → green. Mute = accepting risk → amber caution. */}
      <Button
        size="sm"
        variant="outline"
        onClick={() => void recheck()}
        disabled={busy !== null}
        className="border-success/30 bg-success/10 text-success hover:bg-success/20 hover:text-success"
      >
        {busy === "recheck" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
        I fixed it - recheck
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void toggleMute()}
        disabled={busy !== null}
        className={
          muted
            ? ""
            : "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20 hover:text-warning"
        }
      >
        {busy === "mute" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : muted ? (
          <Bell className="size-3.5" />
        ) : (
          <BellOff className="size-3.5" />
        )}
        {muted ? "Unmute" : "Mute (accept risk)"}
      </Button>
    </div>
  );
}
