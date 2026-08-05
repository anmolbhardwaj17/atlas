import path from "node:path";

/**
 * Static security headers for the browser-facing app (security sweep H3). The Content-Security-Policy
 * is NOT here — it needs a per-request nonce, so it's set in `src/middleware.ts` (the script-src
 * lockdown that this comment previously deferred). These are the static, request-independent headers.
 */
const securityHeaders = [
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
  // Emit `.next/standalone` — a self-contained server bundle with only the traced runtime deps.
  // This is what makes a small web container possible at all (docs/17 §3 calls for three images;
  // the web one had no build target before). Harmless for `next start` / a PaaS deploy.
  output: "standalone",
  experimental: {
    // Navigation feel: <Link> prefetches each route's loading.tsx shell, but Next's default
    // `staleTimes.dynamic` of 0 throws that prefetch away immediately — so clicking a dynamic
    // (force-dynamic) route waited for a full server round-trip before the URL/skeleton changed,
    // which read as a "frozen" click. A short client-cache window lets the prefetched destination
    // skeleton appear the instant you navigate. It also keeps a just-visited page cached for the
    // window, so quick back/forward is instant; first visits always render fresh, and an org switch
    // or router.refresh() busts the cache. 30s is short enough that graph data never reads as stale.
    staleTimes: { dynamic: 30, static: 180 },
  },
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
