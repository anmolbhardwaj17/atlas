import path from "node:path";

/**
 * Security headers for the browser-facing app (security sweep H3). The JSON API sets its own
 * nosniff/frame/referrer headers; the HTML app previously set NONE, leaving it open to clickjacking
 * (no frame-ancestors) and with no HSTS/nosniff/referrer policy.
 *
 * The CSP here intentionally covers only the directives that are safe to apply app-wide without
 * breaking Next's hydration or the app's cross-origin calls to the API/Supabase. Crucially it omits
 * `default-src`: setting it would make `script-src`/`style-src`/`connect-src`/`img-src` fall back to
 * it and break hydration + every API/Supabase/WebSocket call. The directives below have no such
 * fallout — `frame-ancestors 'none'` is the robust header-only anti-clickjacking control; `base-uri`
 * blocks <base> injection; `object-src 'none'` kills plugin embeds; `form-action 'self'` stops form
 * hijacking. A full `script-src`/`style-src` lockdown needs per-request nonces wired through the Next
 * middleware + testing, so it's deliberately deferred — tracked as follow-up hardening.
 */
const CSP = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // HSTS is ignored by browsers over plain HTTP (dev), and enforced once served over HTTPS (prod).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo: pin the file-tracing root to the repo root so Next doesn't warn
  // about inferring it from multiple lockfiles.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
  // Avatar sources: Google profile photos + generated DiceBear avatars. Rendered with the
  // `unoptimized` prop, but next/image still validates the hostname against this allowlist.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      { protocol: "https", hostname: "api.dicebear.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
