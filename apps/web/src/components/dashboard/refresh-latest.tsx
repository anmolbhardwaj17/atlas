"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listConnections, triggerSync } from "@/lib/browser-api";

/**
 * "Fetch latest" - manually re-sync every connected source, then refresh the dashboard.
 * Rendered for Admin/Owner only (sync is an Admin action server-side). Syncs run in the
 * background (minutes, docs/06), so we don't block: we report that new data lands
 * progressively and refresh the view to reflect status/freshness. A source whose dev
 * credentials aren't resolvable (in-memory broker) surfaces as a "reconnect" hint.
 */
export function RefreshLatest({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const active = (await listConnections(orgId)).filter(
        (c) => !c.demo && (c.status === "connected" || c.status === "degraded"),
      );
      if (active.length === 0) {
        setMsg({ tone: "warn", text: "No connected sources to refresh yet." });
        return;
      }
      const results = await Promise.allSettled(active.map((c) => triggerSync(orgId, c.id)));
      const started = results.filter((r) => r.status === "fulfilled").length;
      const blocked = active.filter((_, i) => results[i]?.status === "rejected");

      if (started > 0) {
        setMsg({
          tone: "ok",
          text: `Refreshing ${started} source${started > 1 ? "s" : ""} - new data appears in a few minutes.`,
        });
        // Reflect status/freshness now; the sync itself continues in the background.
        setTimeout(() => router.refresh(), 1500);
      }
      if (blocked.length > 0) {
        const names = blocked.map((c) => c.displayName).join(", ");
        setMsg({
          tone: "warn",
          text:
            started > 0
              ? `${started} started · reconnect to refresh: ${names}`
              : `Reconnect to refresh: ${names}`,
        });
      }
    } catch (e) {
      setMsg({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't refresh." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy}>
        <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
        Fetch latest
      </Button>
      {msg ? (
        <span
          className={`max-w-[16rem] text-right text-xs ${
            msg.tone === "ok" ? "text-muted-foreground" : "text-warning"
          }`}
        >
          {msg.text}
        </span>
      ) : null}
    </div>
  );
}
