import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Monorepo: pin the file-tracing root to the repo root so Next doesn't warn
  // about inferring it from multiple lockfiles.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
};

export default nextConfig;
