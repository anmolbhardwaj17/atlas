"use client";

import * as React from "react";
import { Building2, Check, Loader2, Pencil, Upload, X } from "lucide-react";
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
        {/* Logo — the org's mark, shown across the app. */}
        <div className="flex items-center gap-4">
          <OrgLogo name={name} logoUrl={logoUrl} size={56} className="rounded-lg" />
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Logo
            </p>
            {canEdit ? (
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  onChange={(e) => void onPickLogo(e)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  disabled={logoBusy}
                >
                  {logoBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Upload className="size-3.5" />
                  )}
                  {logoUrl ? "Replace" : "Upload"}
                </Button>
                {logoUrl ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void removeLogo()}
                    disabled={logoBusy}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {logoUrl ? "Set by an admin" : "No logo set"}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">PNG, JPEG, WebP, GIF, or SVG.</p>
          </div>
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
