import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** OAuth redirect target (docs/12 §2.1). Supabase sends the user here with a
 *  `code`; we exchange it for a session (sets httpOnly cookies) and land on the
 *  app. The PKCE/state/nonce handling lives inside Supabase - not here. */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const res = NextResponse.redirect(`${origin}${next}`);
      // One-shot flag so the app shows the welcome once on entry after sign-in. It's consumed
      // (deleted) client-side on first render, so a reload or return visit won't re-trigger it.
      res.cookies.set("atlas_welcome", "1", {
        path: "/",
        maxAge: 300,
        httpOnly: false,
        sameSite: "lax",
      });
      return res;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
