import path from "node:path";

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
};

export default nextConfig;
