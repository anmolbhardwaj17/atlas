"use client";

import * as React from "react";
import { toast } from "sonner";
import { Bell, Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAlertPolicy, setAlertPolicy, type AlertPolicy } from "@/lib/browser-api";
import { cn } from "@/lib/cn";

const OPTIONS: Array<{ value: AlertPolicy; label: string; desc: string }> = [
  {
    value: "off",
    label: "Monitoring only",
    desc: "The map still turns red, but Atlas never pages you.",
  },
  {
    value: "prod",
    label: "Production incidents",
    desc: "Auto-open a War Room only when a production resource that was healthy breaks.",
  },
  {
    value: "all",
    label: "All incidents",
    desc: "Any resource that regresses from healthy opens a War Room.",
  },
];

/**
 * Incident alert policy (docs/plans/proactive-incidents.md). Gates PROACTIVE paging only — a fresh
 * connect and your existing backlog are never paged (that stays a list in Insights); this is only for
 * a resource that was healthy and just broke. Admin-only.
 */
export function AlertSettingsCard({ orgId }: { orgId: string }) {
  const [policy, setPolicy] = React.useState<AlertPolicy | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void getAlertPolicy(orgId).then(setPolicy);
  }, [orgId]);

  async function choose(p: AlertPolicy) {
    if (p === policy || saving) return;
    const prev = policy;
    setPolicy(p);
    setSaving(true);
    const ok = await setAlertPolicy(orgId, p);
    setSaving(false);
    if (ok) toast.success("Alert policy updated.");
    else {
      setPolicy(prev);
      toast.error("Couldn't save the alert policy.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-4 text-muted-foreground" /> Incident alerts
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          When a healthy resource suddenly breaks, what should Atlas do? Your existing backlog is
          never paged — that stays a list in Insights. This is only for new regressions.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {policy === null ? (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : (
          OPTIONS.map((o) => {
            const active = o.value === policy;
            return (
              <button
                key={o.value}
                type="button"
                disabled={saving}
                onClick={() => void choose(o.value)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors disabled:opacity-60",
                  active
                    ? "border-foreground/40 bg-muted/40"
                    : "border-border hover:border-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                    active ? "border-foreground bg-foreground text-background" : "border-border",
                  )}
                >
                  {active ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="text-sm font-medium">{o.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{o.desc}</span>
                </span>
              </button>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
