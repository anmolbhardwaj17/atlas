"use client";

import * as React from "react";
import { Check, Loader2, Pencil, Plus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { updateMyProfile } from "@/lib/browser-api";
import { fileToLogoDataUrl } from "@/lib/read-image";

// The default avatar is your initials; "avv:shape:<seed>" is a generated geometric shape.
const DEFAULT_AVATAR = "avv:character";
const SHAPE_SEEDS = ["a", "b", "c", "d", "e", "f"];

/**
 * Your personal profile - distinct from the organization. Shows your photo + name + email, and
 * lets you rename yourself and pick an avatar: your Google photo, your initials (the default), or
 * a generated shape. All of it persists to your user record and survives the next login.
 */
export function ProfileCard({
  name,
  email,
  avatarUrl,
}: {
  name: string | null;
  email: string;
  avatarUrl: string | null;
}) {
  const [currentName, setCurrentName] = React.useState(name);
  const [currentAvatar, setCurrentAvatar] = React.useState(avatarUrl ?? DEFAULT_AVATAR);
  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState(name ?? "");
  const [pickedAvatar, setPickedAvatar] = React.useState(currentAvatar);
  const [busy, setBusy] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const photoRef = React.useRef<HTMLInputElement>(null);
  // Your live Google photo, read straight from the session (the stored avatar may have been
  // changed to a generated one, so we always offer the real photo here).
  const [googlePhoto, setGooglePhoto] = React.useState<string | null>(null);

  React.useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        const m = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
        const url =
          (typeof m.avatar_url === "string" && m.avatar_url) ||
          (typeof m.picture === "string" && m.picture) ||
          null;
        if (url) setGooglePhoto(url);
      })
      .catch(() => {});
  }, []);

  // Avatar options: your Google photo (if any), your initials (default), then generated shapes.
  const options = React.useMemo(() => {
    const list: { value: string; label: string }[] = [];
    if (googlePhoto) list.push({ value: googlePhoto, label: "Google photo" });
    list.push({ value: DEFAULT_AVATAR, label: "Your initials" });
    SHAPE_SEEDS.forEach((s, i) =>
      list.push({ value: `avv:shape:${email}-${s}`, label: `Shape ${i + 1}` }),
    );
    return list;
  }, [email, googlePhoto]);

  function startEdit() {
    setDraftName(currentName ?? "");
    setPickedAvatar(currentAvatar);
    setEditing(true);
  }

  function cancelEdit() {
    setDraftName(currentName ?? "");
    setPickedAvatar(currentAvatar);
    setEditing(false);
  }

  // Upload a photo from the user's computer. Applies immediately (like a real avatar change) and
  // becomes the selected option; the URL persists so it survives the next login.
  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      const saved = await updateMyProfile({ avatar: dataUrl });
      if (saved.avatarUrl) {
        setCurrentAvatar(saved.avatarUrl);
        setPickedAvatar(saved.avatarUrl);
      }
      toast.success("Photo updated");
    } catch (err) {
      toast.error("Couldn't upload the photo", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPhotoBusy(false);
    }
  }

  async function save() {
    const nextName = draftName.trim();
    if (!nextName) return;
    setBusy(true);
    try {
      const patch: { name?: string; avatarUrl?: string } = {};
      if (nextName !== (currentName ?? "")) patch.name = nextName;
      if (pickedAvatar !== currentAvatar) patch.avatarUrl = pickedAvatar;
      if (patch.name === undefined && patch.avatarUrl === undefined) {
        setEditing(false);
        return;
      }
      const saved = await updateMyProfile(patch);
      setCurrentName(saved.name);
      if (saved.avatarUrl) setCurrentAvatar(saved.avatarUrl);
      setEditing(false);
      toast.success("Profile updated");
    } catch (e) {
      toast.error("Couldn't update your profile", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="relative">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-4" /> Your profile
        </CardTitle>
      </CardHeader>
      {/* One Edit control, floated top-right — same pattern as the Organization card. */}
      <div className="absolute right-6 top-5">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => void save()} disabled={busy || !draftName.trim()}>
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
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <UserAvatar value={currentAvatar} name={currentName} email={email} size={56} />

          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  if (e.key === "Escape") cancelEdit();
                }}
                placeholder="Your name"
                className="h-9 max-w-xs"
                autoFocus
                aria-label="Your name"
              />
            ) : (
              <span className="block truncate text-lg font-medium">
                {currentName ?? "Add your name"}
              </span>
            )}
            <p
              className={cn("truncate text-sm text-muted-foreground", editing ? "mt-2" : "mt-0.5")}
            >
              {email}
            </p>
          </div>
        </div>

        {editing ? (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Choose an avatar
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPickedAvatar(opt.value)}
                  title={opt.label}
                  aria-label={opt.label}
                  aria-pressed={pickedAvatar === opt.value}
                  className={cn(
                    "rounded-full ring-2 ring-offset-2 ring-offset-background transition",
                    pickedAvatar === opt.value
                      ? "ring-primary"
                      : "ring-transparent hover:ring-border",
                  )}
                >
                  <UserAvatar value={opt.value} name={currentName} email={email} size={40} />
                </button>
              ))}
              {/* Upload a photo from your computer — same 40px footprint, outlined. */}
              <input
                ref={photoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => void onPickPhoto(e)}
              />
              <button
                type="button"
                onClick={() => photoRef.current?.click()}
                disabled={photoBusy}
                title="Upload a photo"
                aria-label="Upload a photo"
                className="grid size-10 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted-foreground transition hover:border-foreground/40 hover:text-foreground disabled:opacity-70"
              >
                {photoBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
              </button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
