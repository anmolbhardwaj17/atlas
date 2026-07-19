"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Slack, Check, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * "Ask Atlas from chat" — one card for both Slack and Discord (the INBOUND chat integrations, where
 * a `/atlas` question gets a grounded, cited answer in-channel). Parameterised by platform so the two
 * stay a single component: same status pill / install button / disconnect / OAuth-result toast. Kept
 * distinct from the outbound Slack/Discord/Teams *alert channels* elsewhere in the hub.
 */

export interface ChatAskStatus {
  connected: boolean;
  /** Workspace (Slack) or server (Discord) name. */
  name: string | null;
  installUrl: string | null;
}

export interface ChatPlatform {
  /** Also the query-param key on the OAuth bounce-back (?slack=… / ?discord=…). */
  key: "slack" | "discord";
  label: string;
  /** Where the answer lands, in the platform's words. */
  surface: string;
  icon: React.ReactNode;
}

/** Discord has no lucide brand glyph — inline its mark (currentColor). */
export function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.446 3c-.21.375-.455.88-.624 1.28a18.27 18.27 0 0 0-5.643 0A12.6 12.6 0 0 0 8.55 3 19.74 19.74 0 0 0 3.677 4.37C.533 9.046-.32 13.58.106 18.057a19.9 19.9 0 0 0 6.073 3.058c.492-.672.93-1.386 1.307-2.136a12.94 12.94 0 0 1-2.058-.986c.173-.127.342-.26.505-.397 3.968 1.844 8.27 1.844 12.19 0 .166.14.335.272.505.397-.657.387-1.35.719-2.06.987.377.75.815 1.463 1.307 2.135a19.84 19.84 0 0 0 6.075-3.057c.5-5.19-.838-9.683-3.51-13.69ZM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.955 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.335-.946 2.42-2.157 2.42Z" />
    </svg>
  );
}

const SUCCESS_COPY: Record<ChatPlatform["key"], string> = {
  slack: "Ask `/atlas` in any channel.",
  discord: "Ask `/atlas` in any channel.",
};

export function ChatAskCard({
  orgId,
  platform,
  status,
  canManage,
  onDisconnect,
}: {
  orgId: string;
  platform: ChatPlatform;
  status: ChatAskStatus | null;
  canManage: boolean;
  onDisconnect: (orgId: string) => Promise<void>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = React.useState(false);
  const shownResult = React.useRef(false);

  // Surface the OAuth redirect result once (?slack=… / ?discord=…).
  React.useEffect(() => {
    if (shownResult.current) return;
    const result = params.get(platform.key);
    if (!result) return;
    shownResult.current = true;
    if (result === "connected") {
      toast.success(`${platform.label} connected`, { description: SUCCESS_COPY[platform.key] });
    } else if (result === "error") {
      const reason = params.get("reason");
      toast.error(`Couldn't connect ${platform.label}`, {
        description:
          reason === "already_connected_to_another_org"
            ? `This ${platform.surface} is already connected to another Atlas organization.`
            : "The install didn't complete. Please try again.",
      });
    }
    router.replace("/integrations");
  }, [params, router, platform]);

  async function disconnect() {
    setBusy(true);
    try {
      await onDisconnect(orgId);
      toast.success(`${platform.label} disconnected`);
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
            {platform.icon}
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">Ask Atlas in {platform.label}</h3>
              {connected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  <Check className="size-3" />
                  Connected{status?.name ? ` · ${status.name}` : ""}
                </span>
              ) : null}
            </div>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask <code className="rounded bg-muted px-1 py-0.5 text-xs">/atlas</code> in any{" "}
              {platform.surface} — e.g. <em>&ldquo;what depends on orders-db?&rdquo;</em> — for a
              grounded, cited answer from your graph, no context-switch to the app.
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
                <span className="size-3.5">{platform.icon}</span>
                Add to {platform.label}
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

/** The two chat platforms, ready to hand to <ChatAskCard>. */
export const CHAT_PLATFORMS: { slack: ChatPlatform; discord: ChatPlatform } = {
  slack: { key: "slack", label: "Slack", surface: "channel", icon: <Slack className="size-5" /> },
  discord: {
    key: "discord",
    label: "Discord",
    surface: "server",
    icon: <DiscordMark className="size-5" />,
  },
};
