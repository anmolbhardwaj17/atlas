"use client";

import * as React from "react";
import { Check, Loader2, Pencil, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/cn";
import { createClient } from "@/lib/supabase/client";
import { updateMyProfile } from "@/lib/browser-api";

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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-4" /> Your profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <UserAvatar value={currentAvatar} name={currentName} email={email} size={56} />

          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void save();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  placeholder="Your name"
                  className="h-9 max-w-xs"
                  autoFocus
                  aria-label="Your name"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="truncate text-base font-medium">
                  {currentName ?? "Add your name"}
                </span>
                <button
                  type="button"
                  onClick={startEdit}
                  aria-label="Edit your profile"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
            )}
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{email}</p>
          </div>
        </div>

        {editing ? (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Choose an avatar
            </p>
            <div className="flex flex-wrap gap-2.5">
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
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void save()} disabled={busy || !draftName.trim()}>
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
                <X className="size-3.5" /> Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
