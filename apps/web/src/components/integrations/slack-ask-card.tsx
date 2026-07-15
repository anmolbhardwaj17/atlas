"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Slack, Check, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { disconnectSlackAsk, type SlackAskStatus } from "@/lib/browser-api";

/**
 * "Ask Atlas in Slack" — the INBOUND chat integration (distinct from the outbound Slack alert
 * channel below in the hub). Lets a workspace ask `/atlas <question>` and get a grounded, cited
 * answer in-channel. Shows connection status + the "Add to Slack" install button (admin-only), and
 * surfaces the ?slack=connected|error result of the OAuth bounce-back as a toast.
 */
export function SlackAskCard({
  orgId,
  status,
  canManage,
}: {
  orgId: string;
  status: SlackAskStatus | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = React.useState(false);
  const shownResult = React.useRef(false);

  // Surface the OAuth redirect result once (the callback bounces back to ?slack=connected|error).
  React.useEffect(() => {
    if (shownResult.current) return;
    const result = params.get("slack");
    if (!result) return;
    shownResult.current = true;
    if (result === "connected") {
      toast.success("Slack connected", { description: "Ask `/atlas` in any channel." });
    } else if (result === "error") {
      const reason = params.get("reason");
      toast.error("Couldn't connect Slack", {
        description:
          reason === "already_connected_to_another_org"
            ? "This workspace is already connected to another Atlas organization."
            : "The install didn't complete. Please try again.",
      });
    }
    router.replace("/integrations");
  }, [params, router]);

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectSlackAsk(orgId);
      toast.success("Slack disconnected");
      router.refresh();
    } catch (e) {
      toast.error("Couldn't disconnect", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  const connected = status?.connected ?? false;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
            <Slack className="size-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">Ask Atlas in Slack</h3>
              {connected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  <Check className="size-3" />
                  Connected{status?.teamName ? ` · ${status.teamName}` : ""}
                </span>
              ) : null}
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              {connected ? (
                <>
                  Ask <code className="rounded bg-muted px-1 py-0.5 text-xs">/atlas</code> in any
                  channel — e.g. <em>&ldquo;what depends on orders-db?&rdquo;</em> — for a grounded,
                  cited answer from your graph.
                </>
              ) : (
                <>
                  Bring Atlas into your workspace: ask{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">/atlas</code> a question
                  and get a grounded, cited answer in-channel — no context-switch to the app.
                </>
              )}
            </p>
          </div>
        </div>

        <div className="shrink-0 sm:ml-auto">
          {!canManage ? (
            <span className="text-xs text-muted-foreground">Admins manage this integration.</span>
          ) : connected ? (
            <Button variant="outline" size="sm" onClick={() => void disconnect()} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Disconnect
            </Button>
          ) : status?.installUrl ? (
            <Button asChild size="sm">
              <a href={status.installUrl}>
                <Slack className="size-3.5" />
                Add to Slack
              </a>
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ExternalLink className="size-3.5" />
              Not configured on this deployment yet
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
