"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Minimal onboarding (docs/12 §6.1): create an org → become Owner. Calls the API
 *  with the Supabase access token; refreshes the page to re-render memberships. */
export function CreateOrgForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      body: JSON.stringify({ name: name.trim() }),
    });
    if (res.ok) {
      setName("");
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
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Organization name"
          disabled={busy}
          aria-label="Organization name"
        />
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
