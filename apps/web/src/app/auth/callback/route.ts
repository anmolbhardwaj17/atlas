import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** OAuth redirect target (docs/12 §2.1). Supabase sends the user here with a
 *  `code`; we exchange it for a session (sets httpOnly cookies) and land on the
 *  app. The PKCE/state/nonce handling lives inside Supabase - not here. */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Default to the app, not `/`. `/` used to be a router that forwarded signed-in users onward;
  // now it's the public landing page, so landing there after sign-in would strand the user on a
  // marketing page having just logged in. An explicit `next` (an /invite/<token> deep link) still
  // wins. An org-less user is picked up by requireShell and sent to /create-org.
  const next = searchParams.get("next") ?? "/dashboard";

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
