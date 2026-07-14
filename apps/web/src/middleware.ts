import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Content-Security-Policy with a per-request nonce (security sweep — the script-src lockdown deferred
 * when the headers first landed). The script-src is the payload: in production only Next's own inline
 * scripts (auto-nonced from the CSP we set on the request) run, and `'strict-dynamic'` lets those load
 * the app chunks — no host allowlist, no inline-script XSS. `default-src` is intentionally OMITTED so
 * connect/img/font stay open for the API, Supabase, WebSockets and avatars (adding it would break them).
 * Styles keep `'unsafe-inline'`: inline style attributes are pervasive (charts, React Flow, dynamic
 * widths) and can't be nonced, and a style injection is a far smaller risk than a script one.
 *
 * Dev relaxes script-src to `'unsafe-eval' 'unsafe-inline'` — Turbopack HMR / React Refresh eval code,
 * which a nonce policy blocks — so the strict policy only applies to the built app (verify against a
 * production build). The nonce is exposed as `x-nonce` for any future inline script we control.
 */
function buildCsp(nonce: string): string {
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `script-src 'self' 'unsafe-eval' 'unsafe-inline'`;
  return [
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = buildCsp(nonce);

  // Give Next the nonce + CSP on the REQUEST headers: Next reads the nonce from the request's CSP and
  // injects it into its framework inline scripts. The Supabase session refresh threads these through
  // its NextResponse.next({ request }) so the forwarded request carries them.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Run on all routes except static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
