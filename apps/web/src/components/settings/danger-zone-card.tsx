"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteOrg } from "@/lib/browser-api";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";

/**
 * Owner-only "delete this organization" — the most destructive action in the app. Two-step
 * confirmation: (1) a disclaimer of exactly what gets erased, then (2) type-the-name to confirm.
 * On success the whole tenant is swept server-side (docs/12 §6.4); we clear the active-org cookie
 * and send the user to `/`, which re-resolves them to another org or the create flow.
 */
export function DangerZoneCard({ orgId, orgName }: { orgId: string; orgName: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<1 | 2>(1);
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const confirmed = confirmText.trim() === orgName.trim();

  function reset() {
    setPhase(1);
    setConfirmText("");
  }

  async function doDelete() {
    if (!confirmed) return;
    setBusy(true);
    try {
      await deleteOrg(orgId);
      // Drop the active-org cookie so requireShell re-resolves to a remaining org (or /create-org).
      document.cookie = `${ACTIVE_ORG_COOKIE}=; path=/; max-age=0; samesite=lax`;
      toast.success(`"${orgName}" was permanently deleted`);
      setOpen(false);
      router.push("/");
      router.refresh();
    } catch (e) {
      toast.error("Couldn’t delete the organization", {
        description: e instanceof Error ? e.message : undefined,
      });
      setBusy(false);
    }
  }

  return (
    <Card className="border-danger/40 bg-danger/[0.03]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-danger">
          <AlertTriangle className="size-4" /> Danger zone
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">Delete this organization</p>
          <p className="mt-0.5 max-w-md text-sm text-muted-foreground">
            Permanently removes {orgName} and all of its data — the graph, connections, members, and
            history. This can&rsquo;t be undone.
          </p>
        </div>
        <Button
          variant="danger"
          className="shrink-0"
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <Trash2 className="size-4" /> Delete organization
        </Button>
      </CardContent>

      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <AlertDialogContent>
          {phase === 1 ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{orgName}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes the organization and <strong>everything in it</strong>:
                </AlertDialogDescription>
              </AlertDialogHeader>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {[
                  "The entire knowledge graph — every resource, dependency, and finding",
                  "All connected sources (AWS, GitHub, …) and their stored credentials",
                  "Members, invitations, AI history, alerts, and settings",
                ].map((line) => (
                  <li key={line} className="flex gap-2">
                    <span
                      aria-hidden
                      className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground"
                    />
                    {line}
                  </li>
                ))}
              </ul>
              <p className="text-sm font-medium text-danger">This cannot be undone.</p>
              <AlertDialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => setPhase(2)}>
                  Continue
                </Button>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Type the name to confirm</AlertDialogTitle>
                <AlertDialogDescription>
                  To confirm, type{" "}
                  <strong className="font-semibold text-foreground">{orgName}</strong> below. This
                  immediately and permanently deletes the organization.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={orgName}
                aria-label="Organization name to confirm"
                autoFocus
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && confirmed) void doDelete();
                }}
              />
              <AlertDialogFooter>
                <Button variant="ghost" onClick={() => setPhase(1)} disabled={busy}>
                  Back
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void doDelete()}
                  disabled={busy || !confirmed}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Delete forever
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
