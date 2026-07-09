"use client";

import * as React from "react";
import { Building2, Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameOrg } from "@/lib/browser-api";

/**
 * Organization identity — just the org's name, renamable by an admin (inline, like the profile).
 * Member count + your role live in the Members panel below. The API enforces Admin+ on rename.
 */
export function OrgCard({
  orgId,
  orgName,
  canEdit,
}: {
  orgId: string;
  orgName: string;
  canEdit: boolean;
}) {
  const [name, setName] = React.useState(orgName);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(orgName);
  const [busy, setBusy] = React.useState(false);

  function startEdit() {
    setDraft(name);
    setEditing(true);
  }

  async function save() {
    const next = draft.trim();
    if (!next || next === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      const saved = await renameOrg(orgId, next);
      setName(saved);
      setEditing(false);
      toast.success("Organization renamed");
    } catch (e) {
      toast.error("Couldn't rename the organization", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4" /> Organization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Name — the org's identity, editable in place. */}
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Name</p>
          {editing ? (
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="h-9 max-w-xs"
                autoFocus
                aria-label="Organization name"
              />
              <Button size="sm" onClick={() => void save()} disabled={busy || !draft.trim()}>
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-base font-medium">{name}</span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={startEdit}
                  aria-label="Rename organization"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
