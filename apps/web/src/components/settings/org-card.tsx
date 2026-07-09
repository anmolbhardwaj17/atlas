"use client";

import * as React from "react";
import { Building2, Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OrgLogo } from "@/components/org-logo";
import { updateOrg } from "@/lib/browser-api";
import { fileToLogoDataUrl } from "@/lib/read-image";

/**
 * Organization identity — the org's logo + name, both editable by an admin. The logo uploads to
 * storage (a `data:` URL, downscaled client-side) and shows as the org's mark in the switcher and
 * settings; the name renames inline like the profile. The API enforces Admin+ on both.
 */
export function OrgCard({
  orgId,
  orgName,
  orgLogoUrl,
  canEdit,
}: {
  orgId: string;
  orgName: string;
  orgLogoUrl: string | null;
  canEdit: boolean;
}) {
  const [name, setName] = React.useState(orgName);
  const [logoUrl, setLogoUrl] = React.useState(orgLogoUrl);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(orgName);
  const [busy, setBusy] = React.useState(false);
  const [logoBusy, setLogoBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

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
      const saved = await updateOrg(orgId, { name: next });
      setName(saved.name || next);
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

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setLogoBusy(true);
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      const saved = await updateOrg(orgId, { logo: dataUrl });
      setLogoUrl(saved.logoUrl);
      toast.success("Logo updated");
    } catch (err) {
      toast.error("Couldn't update the logo", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      await updateOrg(orgId, { logo: null });
      setLogoUrl(null);
      toast.success("Logo removed");
    } catch (err) {
      toast.error("Couldn't remove the logo", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4" /> Organization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Logo — the tile itself is the control: a corner badge shows + (add) or ✎ (replace) and
            opens the picker; when a logo is set, a hover ✕ removes it. No labels needed. */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            onChange={(e) => void onPickLogo(e)}
          />
          {canEdit ? (
            <div className="group relative w-fit">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={logoBusy}
                aria-label={logoUrl ? "Replace logo" : "Upload logo"}
                className="relative block shrink-0 rounded-lg outline-none ring-ring transition focus-visible:ring-2 disabled:opacity-70"
              >
                <OrgLogo
                  name={name}
                  logoUrl={logoUrl}
                  size={56}
                  className="rounded-lg transition group-hover:brightness-95"
                />
                <span className="absolute -bottom-1.5 -right-1.5 grid size-6 place-items-center rounded-full border border-border bg-background text-foreground shadow-sm transition group-hover:bg-accent">
                  {logoBusy ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : logoUrl ? (
                    <Pencil className="size-3" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                </span>
              </button>
              {logoUrl && !logoBusy ? (
                <button
                  type="button"
                  onClick={() => void removeLogo()}
                  aria-label="Remove logo"
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ) : (
            <OrgLogo name={name} logoUrl={logoUrl} size={56} className="rounded-lg" />
          )}
        </div>

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
