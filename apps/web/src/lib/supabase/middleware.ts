import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

/** Refreshes the Supabase session cookie on every request (docs/12 §3 - Supabase
 *  manages the access/refresh lifecycle; this keeps server reads from seeing an
 *  expired token). Standard @supabase/ssr middleware pattern. `requestHeaders` carries the CSP
 *  nonce set by the middleware; it's forwarded on the outgoing request so Next can nonce its inline
 *  scripts, and re-synced with any Supabase-refreshed cookie so downstream reads still see it. */
export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers,
): Promise<NextResponse> {
  const nextInit = (): { request: { headers: Headers } } | { request: NextRequest } =>
    requestHeaders ? { request: { headers: requestHeaders } } : { request };
  let response = NextResponse.next(nextInit());

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // Keep the forwarded headers in sync with the refreshed cookies (they'd otherwise be stale,
        // since requestHeaders is a snapshot taken before this refresh).
        requestHeaders?.set("cookie", request.headers.get("cookie") ?? "");
        response = NextResponse.next(nextInit());
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touch the user to trigger a refresh if the access token is near expiry. If Supabase itself is
  // unreachable (outage / paused project → network `fetch failed`), fail soft: pass the request
  // through with whatever cookies exist rather than throwing, which would 500 *every* route. The
  // server-side auth guards then treat the request as unauthenticated and redirect to /login,
  // instead of the whole app crashing on a transient upstream blip.
  try {
    const { data } = await supabase.auth.getUser();
    // Already signed in? Don't let them sit on /login - send them into the app.
    if (data.user && request.nextUrl.pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      const redirect = NextResponse.redirect(url);
      for (const c of response.cookies.getAll()) redirect.cookies.set(c.name, c.value, c);
      return redirect;
    }
  } catch {
    // Swallow - a reachability failure is not an auth decision. Downstream guards handle no-session.
  }
  return response;
}
