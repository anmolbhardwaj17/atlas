"use client";

import * as React from "react";
import { Bell, Check, Loader2, Send, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getNotificationStatus,
  setSlackWebhook,
  testNotification,
  disableNotifications,
  type NotificationStatus,
} from "@/lib/browser-api";

/**
 * Proactive alerts (pull → push). Paste a Slack incoming-webhook URL and Atlas pushes a
 * heads-up when something breaks/recovers, plus a daily digest. The webhook is write-only -
 * the server never returns it, so we show a masked hint once configured.
 */
export function NotificationsSettingsCard({
  orgId,
  initial,
}: {
  orgId: string;
  initial: NotificationStatus | null;
}) {
  const [status, setStatus] = React.useState<NotificationStatus | null>(initial);
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  async function refresh() {
    setStatus(await getNotificationStatus(orgId));
  }

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await setSlackWebhook(orgId, url.trim());
      setUrl("");
      await refresh();
      setNote({ tone: "ok", text: "Slack connected. Send a test to see it land." });
    } catch (e) {
      setNote({
        tone: "warn",
        text: e instanceof Error ? e.message : "Couldn't save that webhook.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setNote(null);
    try {
      const r = await testNotification(orgId);
      setNote({ tone: r.delivered ? "ok" : "warn", text: r.message });
    } catch (e) {
      setNote({ tone: "warn", text: e instanceof Error ? e.message : "Test failed." });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setNote(null);
    try {
      await disableNotifications(orgId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const configured = status?.configured === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4" /> Alerts &amp; digest
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Get a Slack heads-up the moment a resource breaks, recovers, or gets exposed — plus a
          short daily digest of what changed. Atlas already watches your estate; this is how it
          reaches you.
        </p>

        {configured ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <Check className="size-4 text-success" />
              Slack connected{" "}
              <span className="font-mono text-xs text-muted-foreground">{status?.hint}</span>
            </span>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void test()} disabled={busy}>
                <Send className="size-3.5" /> Test
              </Button>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                aria-label="Disconnect Slack"
                className="text-muted-foreground hover:text-danger"
              >
                <Trash2 className="size-4" />
              </button>
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            <label htmlFor="slack-url" className="text-sm font-medium">
              Slack incoming-webhook URL
            </label>
            <div className="flex gap-2">
              <Input
                id="slack-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                autoComplete="off"
                spellCheck={false}
              />
              <Button onClick={() => void save()} disabled={busy || url.trim().length === 0}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Connect"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Create one at Slack → Apps → Incoming Webhooks, pick a channel, and paste the URL. It
              never leaves Atlas and is never shown again.
            </p>
          </div>
        )}

        {note ? (
          <p className={`text-sm ${note.tone === "ok" ? "text-success" : "text-danger"}`}>
            {note.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
