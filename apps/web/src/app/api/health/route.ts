import { NextResponse } from "next/server";

/**
 * Liveness probe for the web container (Fly health check, `fly.web.toml`).
 *
 * It exists because there was nothing else safe to point a check at. `/` is a pure router that
 * always `redirect()`s — to /login, /dashboard or /create-org — so it never returns 200 and an HTTP
 * check against it fails permanently: Fly then marks the machine unhealthy, the proxy reports "could
 * not find a good candidate", and the app is unreachable even though Next started fine.
 *
 * Deliberately dumb: it answers "is this Next server serving requests?" and nothing more. It does
 * NOT check Supabase or the API — a health check that depends on downstream services turns one
 * outage into two, taking the frontend out of rotation when it could still render a login page or
 * an error state. The API has its own `/health/ready` for the dependency-aware version.
 */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
