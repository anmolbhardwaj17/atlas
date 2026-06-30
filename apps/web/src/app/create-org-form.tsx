"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { apiUrl } from "@/lib/env";

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
    <form onSubmit={submit} style={{ display: "flex", gap: ".5rem", marginTop: ".75rem" }}>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Organization name"
        disabled={busy}
        style={{
          flex: 1,
          padding: ".5rem .75rem",
          borderRadius: 6,
          border: "1px solid #2a2f3a",
          background: "#11141b",
          color: "#e8eaed",
        }}
      />
      <button
        type="submit"
        disabled={busy}
        style={{
          padding: ".5rem 1rem",
          borderRadius: 6,
          border: "1px solid #2a2f3a",
          background: busy ? "#1a1e27" : "#8ab4f8",
          color: busy ? "#9aa0a6" : "#0b0d12",
          fontWeight: 600,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "Creating…" : "Create"}
      </button>
      {error ? <span style={{ color: "#f28b82", alignSelf: "center" }}>{error}</span> : null}
    </form>
  );
}
