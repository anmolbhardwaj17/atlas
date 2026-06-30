"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Sign-in screen (docs/09 login, docs/12 §2.1). One button → Supabase-hosted
 *  Google OAuth. Supabase redirects to /auth/callback to complete the session. */
export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle(): Promise<void> {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#0b0d12",
        color: "#e8eaed",
      }}
    >
      <div style={{ width: 360, padding: "2.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.6rem", margin: 0 }}>Atlas</h1>
        <p style={{ color: "#9aa0a6", marginTop: ".5rem", marginBottom: "2rem" }}>
          Engineering Intelligence Platform
        </p>
        <button
          onClick={signInWithGoogle}
          disabled={busy}
          style={{
            width: "100%",
            padding: ".75rem 1rem",
            borderRadius: 8,
            border: "1px solid #2a2f3a",
            background: busy ? "#1a1e27" : "#fff",
            color: busy ? "#9aa0a6" : "#111",
            fontSize: "0.95rem",
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Redirecting…" : "Sign in with Google"}
        </button>
        {error ? <p style={{ color: "#f28b82", marginTop: "1rem" }}>{error}</p> : null}
      </div>
    </main>
  );
}
