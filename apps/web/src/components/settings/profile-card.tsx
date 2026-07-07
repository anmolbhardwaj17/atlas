"use client";

import * as React from "react";
import Image from "next/image";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { updateMyProfile } from "@/lib/browser-api";

/** Deterministic DiceBear avatar URL (offline-friendly service; SVG). */
function dicebear(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

// A few friendly DiceBear styles to pick from when you'd rather not use a photo.
const DICEBEAR_STYLES = ["thumbs", "avataaars", "bottts", "fun-emoji", "notionists", "lorelei"];

/**
 * Your personal profile - distinct from the organization. Shows your photo + name + email, and
 * lets you rename yourself and pick an avatar (your Google photo or a generated DiceBear one).
 * All of it persists to your user record and survives the next login.
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
  const fallback = dicebear("thumbs", email);
  const [currentName, setCurrentName] = React.useState(name);
  const [currentAvatar, setCurrentAvatar] = React.useState(avatarUrl ?? fallback);
  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState(name ?? "");
  const [pickedAvatar, setPickedAvatar] = React.useState(currentAvatar);
  const [busy, setBusy] = React.useState(false);

  // The avatar options: your real photo (if any) plus a generated set seeded by your email.
  const options = React.useMemo(() => {
    const list: { url: string; label: string }[] = [];
    if (avatarUrl) list.push({ url: avatarUrl, label: "Your photo" });
    for (const s of DICEBEAR_STYLES) list.push({ url: dicebear(s, email), label: s });
    return list;
  }, [avatarUrl, email]);

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
        <CardTitle>Your profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Image
            src={currentAvatar}
            alt={currentName ?? email}
            width={56}
            height={56}
            unoptimized
            className="size-14 shrink-0 rounded-full border border-border bg-muted object-cover"
          />

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
                  key={opt.url}
                  type="button"
                  onClick={() => setPickedAvatar(opt.url)}
                  title={opt.label}
                  aria-label={opt.label}
                  aria-pressed={pickedAvatar === opt.url}
                  className={cn(
                    "rounded-full ring-2 ring-offset-2 ring-offset-background transition",
                    pickedAvatar === opt.url
                      ? "ring-primary"
                      : "ring-transparent hover:ring-border",
                  )}
                >
                  <Image
                    src={opt.url}
                    alt={opt.label}
                    width={40}
                    height={40}
                    unoptimized
                    className="size-10 rounded-full border border-border bg-muted object-cover"
                  />
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
