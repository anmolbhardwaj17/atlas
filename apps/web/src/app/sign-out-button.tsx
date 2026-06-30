"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Ends the Supabase session (docs/12 §3 — revocation handled by Supabase) and
 *  refreshes the server-rendered page. */
export function SignOutButton() {
  const router = useRouter();

  async function signOut(): Promise<void> {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      style={{
        padding: ".4rem .8rem",
        borderRadius: 6,
        border: "1px solid #2a2f3a",
        background: "transparent",
        color: "#9aa0a6",
        cursor: "pointer",
        fontSize: ".85rem",
      }}
    >
      Sign out
    </button>
  );
}
