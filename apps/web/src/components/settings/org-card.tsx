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
import { ORG_UPDATED_EVENT } from "@/lib/active-org";

/** Tell the org switcher (which self-fetches) to re-pull after a name/logo change. */
function notifyOrgUpdated() {
  window.dispatchEvent(new Event(ORG_UPDATED_EVENT));
}

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
      notifyOrgUpdated();
      toast.success("Organization renamed");
    } catch (e) {
      toast.error("Couldn’t rename the organization", {
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
      notifyOrgUpdated();
      toast.success("Logo updated");
    } catch (err) {
      toast.error("Couldn’t update the logo", {
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
      notifyOrgUpdated();
      toast.success("Logo removed");
    } catch (err) {
      toast.error("Couldn’t remove the logo", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLogoBusy(false);
    }
  }

  function cancelEdit() {
    setDraft(name);
    setEditing(false);
  }

  return (
    <Card className="relative">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4" /> Organization
        </CardTitle>
      </CardHeader>
      {/* One Edit control, floated top-right so the header (and its title) stays identical to the
          profile card's — toggles editing both the logo and the name together. */}
      {canEdit ? (
        <div className="absolute right-6 top-5">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <Button size="sm" onClick={() => void save()} disabled={busy || !draft.trim()}>
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={cancelEdit}
                disabled={busy}
                aria-label="Cancel"
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={startEdit}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          )}
        </div>
      ) : null}
      <CardContent>
        {/* Logo left, name right. In edit mode the logo tile becomes a control (corner + / ✎ badge
            opens the picker; a ✕ removes it) and the name becomes an input. */}
        <div className="flex items-center gap-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void onPickLogo(e)}
          />
          {editing ? (
            <div className="group relative w-fit shrink-0">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={logoBusy}
                aria-label={logoUrl ? "Replace logo" : "Upload logo"}
                className="relative block rounded-lg outline-none ring-ring transition focus-visible:ring-2 disabled:opacity-70"
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
            <OrgLogo name={name} logoUrl={logoUrl} size={56} className="shrink-0 rounded-lg" />
          )}

          {editing ? (
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") cancelEdit();
              }}
              className="h-9 max-w-xs"
              autoFocus
              aria-label="Organization name"
            />
          ) : (
            <span className="truncate text-lg font-medium">{name}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
