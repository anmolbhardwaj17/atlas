"use client";

import * as React from "react";
import { Bell, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChannelIcon } from "@/components/settings/channel-icon";
import { cn } from "@/lib/cn";
import {
  setChannel,
  testChannel,
  removeChannel,
  type ChannelKind,
  type ChannelSummary,
} from "@/lib/browser-api";

interface ChannelMeta {
  kind: ChannelKind;
  label: string;
  placeholder: string;
  help: React.ReactNode;
}

const CHANNELS: ChannelMeta[] = [
  {
    kind: "slack",
    label: "Slack",
    placeholder: "https://hooks.slack.com/services/…",
    help: "Slack → Apps → Incoming Webhooks → pick a channel → copy the URL.",
  },
  {
    kind: "discord",
    label: "Discord",
    placeholder: "https://discord.com/api/webhooks/…",
    help: "Server Settings → Integrations → Webhooks → New Webhook → copy the URL.",
  },
  {
    kind: "msteams",
    label: "Microsoft Teams",
    placeholder: "https://….webhook.office.com/…",
    help: "Channel → ⋯ → Connectors → Incoming Webhook → create → copy the URL.",
  },
];

// A fallback that is definitely present, so metaFor always returns a ChannelMeta.
const SLACK_META: ChannelMeta = {
  kind: "slack",
  label: "Slack",
  placeholder: "https://hooks.slack.com/services/…",
  help: "Slack → Apps → Incoming Webhooks → pick a channel → copy the URL.",
};
const metaFor = (kind: ChannelKind): ChannelMeta =>
  CHANNELS.find((c) => c.kind === kind) ?? SLACK_META;

/**
 * Proactive alerts (pull → push). Wire one or more outbound channels - Slack, Discord, or
 * Microsoft Teams (all simple incoming webhooks) - and Atlas pushes a heads-up when something
 * breaks/recovers, plus a daily digest. Webhooks are write-only: the server never returns them,
 * so we only ever show a masked hint once configured.
 */
export function NotificationsSettingsCard({
  orgId,
  initial,
}: {
  orgId: string;
  initial: ChannelSummary[] | null;
}) {
  const [channels, setChannels] = React.useState<ChannelSummary[]>(initial ?? []);

  const configured = new Set(channels.map((c) => c.kind));
  const available = CHANNELS.filter((c) => !configured.has(c.kind));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4" /> Alerts &amp; digest
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Get a heads-up in Slack, Discord, or Teams the moment a resource breaks, recovers, or gets
          exposed - plus a short daily digest of what changed. Atlas already watches your estate;
          this is how it reaches you.
        </p>

        {channels.length > 0 ? (
          <ul className="space-y-2">
            {channels.map((ch) => (
              <ConfiguredChannel
                key={ch.kind}
                orgId={orgId}
                channel={ch}
                onRemoved={(next) => setChannels(next)}
              />
            ))}
          </ul>
        ) : null}

        {available.length > 0 ? (
          <AddChannel orgId={orgId} available={available} onAdded={(next) => setChannels(next)} />
        ) : (
          <p className="text-xs text-muted-foreground">
            All channels connected. Remove one to swap its webhook.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** A connected channel: masked hint + Test + disconnect. */
function ConfiguredChannel({
  orgId,
  channel,
  onRemoved,
}: {
  orgId: string;
  channel: ChannelSummary;
  onRemoved: (next: ChannelSummary[]) => void;
}) {
  const meta = metaFor(channel.kind);
  const [busy, setBusy] = React.useState<"test" | "remove" | null>(null);

  async function test() {
    setBusy("test");
    try {
      const r = await testChannel(orgId, channel.kind);
      if (r.delivered) toast.success(`Test sent to ${meta.label}`, { description: r.message });
      else toast.error(`${meta.label} didn't accept it`, { description: r.message });
    } catch (e) {
      toast.error("Test failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      const next = await removeChannel(orgId, channel.kind);
      onRemoved(next);
      toast.success(`${meta.label} disconnected`);
    } catch (e) {
      toast.error("Couldn't disconnect", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <span className="flex min-w-0 items-center gap-2.5">
        <ChannelIcon kind={channel.kind} className="size-5" />
        <span className="font-medium">{meta.label}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{channel.hint}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void test()} disabled={busy !== null}>
          {busy === "test" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Test
        </Button>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy !== null}
          aria-label={`Disconnect ${meta.label}`}
          className="text-muted-foreground transition-colors hover:text-danger disabled:opacity-50"
        >
          {busy === "remove" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </button>
      </span>
    </li>
  );
}

/** Add a not-yet-configured channel: pick the kind, paste its webhook, connect. */
function AddChannel({
  orgId,
  available,
  onAdded,
}: {
  orgId: string;
  available: ChannelMeta[];
  onAdded: (next: ChannelSummary[]) => void;
}) {
  const [kind, setKind] = React.useState<ChannelKind>(available[0]?.kind ?? "slack");
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Keep the selected kind valid as channels get added/removed.
  React.useEffect(() => {
    if (!available.some((a) => a.kind === kind)) setKind(available[0]?.kind ?? "slack");
  }, [available, kind]);

  const meta = metaFor(kind);

  async function save() {
    setBusy(true);
    try {
      const next = await setChannel(orgId, kind, url.trim());
      setUrl("");
      onAdded(next);
      toast.success(`${meta.label} connected`, { description: "Send a test to see it land." });
    } catch (e) {
      toast.error(`Couldn't connect ${meta.label}`, {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Add a channel
      </p>
      {available.length > 1 ? (
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5 text-xs">
          {available.map((a) => (
            <button
              key={a.kind}
              type="button"
              onClick={() => setKind(a.kind)}
              aria-pressed={kind === a.kind}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors",
                kind === a.kind
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ChannelIcon kind={a.kind} className="size-3.5" />
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={meta.placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-label={`${meta.label} webhook URL`}
        />
        <Button onClick={() => void save()} disabled={busy || url.trim().length === 0}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Connect
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {meta.help} It never leaves Atlas and is never shown again.
      </p>
    </div>
  );
}
