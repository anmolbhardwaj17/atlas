import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where to send the browser back to.
 *
 * `new URL(request.url).origin` is the address the SERVER saw, which behind a proxy is the
 * container's own bind address - in production that made this route redirect people to
 * `https://0.0.0.0:4291/dashboard` after a successful sign-in, which resolves to nothing on their
 * device. The public hostname only exists in the forwarded headers, so those come first.
 *
 * `x-forwarded-host` is set by Fly's proxy; `host` covers a direct hit; the request URL is the
 * last resort for local development, where there is no proxy in front.
 */
function publicOrigin(request: Request): string {
  const h = request.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return new URL(request.url).origin;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * `next` arrives in the query string, so it is attacker-controllable: `?next=https://evil.example`
 * would turn this route into an open redirect that borrows our domain's credibility. Only a
 * same-site absolute path is allowed, and `//` is rejected because the browser reads it as a
 * protocol-relative URL to another host.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

/** OAuth redirect target (docs/12 §2.1). Supabase sends the user here with a
 *  `code`; we exchange it for a session (sets httpOnly cookies) and land on the
 *  app. The PKCE/state/nonce handling lives inside Supabase - not here. */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const code = searchParams.get("code");
  // Default to the app, not `/`. `/` used to be a router that forwarded signed-in users onward;
  // now it's the public landing page, so landing there after sign-in would strand the user on a
  // marketing page having just logged in. An explicit `next` (an /invite/<token> deep link) still
  // wins. An org-less user is picked up by requireShell and sent to /create-org.
  const next = safeNext(searchParams.get("next"));

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
