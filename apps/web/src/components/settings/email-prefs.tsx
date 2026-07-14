"use client";

import * as React from "react";
import { toast } from "sonner";
import { Mail, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmailPrefs, setEmailPrefs, type EmailPrefs } from "@/lib/browser-api";
import { cn } from "@/lib/cn";

const ROWS: Array<{ key: keyof EmailPrefs; label: string; desc: string }> = [
  {
    key: "incidentEmail",
    label: "Incident alerts",
    desc: "Email me when a healthy production resource suddenly breaks.",
  },
  {
    key: "weeklyDigest",
    label: "Weekly digest",
    desc: "A Monday summary of what changed, what's at risk, and what got fixed.",
  },
];

/**
 * Per-user email preferences (self-scoped — every member controls their own mail, so this is not
 * admin-gated). Incident alerts previously went to all members with no opt-out; the weekly digest
 * was only toggleable from the email's unsubscribe link. Both now live here, on/off, saved per org.
 */
export function EmailPrefsCard({ orgId }: { orgId: string }) {
  const [prefs, setPrefs] = React.useState<EmailPrefs | null>(null);
  const [saving, setSaving] = React.useState<keyof EmailPrefs | null>(null);

  React.useEffect(() => {
    void getEmailPrefs(orgId).then(setPrefs);
  }, [orgId]);

  async function toggle(key: keyof EmailPrefs) {
    if (!prefs || saving) return;
    const next = !prefs[key];
    const prev = prefs;
    setPrefs({ ...prefs, [key]: next }); // optimistic
    setSaving(key);
    const result = await setEmailPrefs(orgId, { [key]: next });
    setSaving(null);
    if (result) setPrefs(result);
    else {
      setPrefs(prev);
      toast.error("Couldn't save your email preference.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-4 text-muted-foreground" /> Email notifications
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose which emails Atlas sends you for this workspace. In-app notifications (the bell)
          aren't affected.
        </p>
      </CardHeader>
      <CardContent className="space-y-1">
        {prefs === null ? (
          <p className="inline-flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : (
          ROWS.map((r) => {
            const on = prefs[r.key];
            const busy = saving === r.key;
            return (
              <div
                key={r.key}
                className="flex items-center justify-between gap-4 rounded-lg px-1 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.label}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{r.desc}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${on ? "Disable" : "Enable"} ${r.label.toLowerCase()}`}
                  disabled={busy}
                  onClick={() => void toggle(r.key)}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    on ? "bg-foreground" : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block size-4 rounded-full bg-background shadow transition-transform",
                      on ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
