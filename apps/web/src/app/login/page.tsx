"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    <main className="grid min-h-dvh place-items-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            A
          </div>
          <CardTitle className="text-xl">Welcome to Atlas</CardTitle>
          <CardDescription>Engineering Intelligence Platform</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={signInWithGoogle} disabled={busy} variant="outline" className="w-full">
            {busy ? "Redirecting…" : "Sign in with Google"}
          </Button>
          {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
