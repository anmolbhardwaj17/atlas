"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";
import { fileToLogoDataUrl } from "@/lib/read-image";
import { OrgLogo } from "@/components/org-logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Minimal onboarding (docs/12 §6.1): create an org → become Owner. Optionally attach a logo
 *  (uploaded to storage server-side). Calls the API with the Supabase access token; refreshes
 *  the page to re-render memberships. */
export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [logo, setLogo] = useState<string | null>(null); // data URL, if picked
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setLogo(await fileToLogoDataUrl(file));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that image.");
    }
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch(`${apiUrl()}/orgs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ name: name.trim(), ...(logo ? { logo } : {}) }),
    });
    if (res.ok) {
      // Land inside the org we just created — set it active, then go to its dashboard. Without this
      // a refresh would drop us into whatever org is default/first, not the new one (and for an
      // existing user, `/` would just bounce back to their current org).
      const created = (await res.json().catch(() => null)) as { data?: { id?: string } } | null;
      const newOrgId = created?.data?.id;
      if (newOrgId) {
        document.cookie = `${ACTIVE_ORG_COOKIE}=${newOrgId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      }
      setName("");
      setLogo(null);
      router.push("/dashboard");
      router.refresh();
    } else {
      const body: unknown = await res.json().catch(() => null);
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? (body as { error: { message?: string } }).error.message
          : `Request failed (${res.status})`;
      setError(message ?? `Request failed (${res.status})`);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex items-center gap-3">
        {/* Logo picker — click the mark to choose; a small × clears it. Optional. */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => void onPickLogo(e)}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Add a logo"
          className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          {logo ? (
            <OrgLogo name={name} logoUrl={logo} size={44} className="rounded-lg border-solid" />
          ) : (
            <ImagePlus className="size-4" />
          )}
        </button>
        {logo ? (
          <button
            type="button"
            onClick={() => setLogo(null)}
            disabled={busy}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Remove logo"
          >
            <X className="size-4" />
          </button>
        ) : null}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Organization name"
          disabled={busy}
          aria-label="Organization name"
        />
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Create"}
        </Button>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </form>
  );
}
