#!/usr/bin/env bash
#
# Post-deploy smoke test — proves a DEPLOYED Atlas actually serves users.
#
# Why this exists: every other gate (unit, integration, web-build, images) runs against source or a
# container, and all of them passed on the deploy that took production down. The web health check
# had been pointed at `/`, a route that always redirect()s and therefore can never return 200 — Fly
# marked the machine unhealthy and the proxy served "could not find a good candidate" while Next was
# running perfectly. Nothing in CI could have caught that, because the bug only exists once the app
# is behind a real proxy, answering real HTTP.
#
# Deploys are deliberately NOT gated on this (push to main always ships, by the owner's decision).
# It runs after the rollout and fails the workflow loudly, so a broken production announces itself
# instead of waiting to be clicked on.
#
# Usage:  API_URL=… WEB_URL=… scripts/smoke.sh
# Local:  API_URL=http://localhost:4290 WEB_URL=http://localhost:4291 scripts/smoke.sh
set -uo pipefail

API_URL="${API_URL:-https://atlas-api-v1.fly.dev}"
WEB_URL="${WEB_URL:-https://atlas-web.fly.dev}"
API_URL="${API_URL%/}"
WEB_URL="${WEB_URL%/}"

pass=0
fail=0

# check <name> <command...> — the command's stdout is captured; a non-zero exit fails the check.
check() {
  local name="$1"
  shift
  local out
  if out="$("$@" 2>&1)"; then
    printf '  ✓ %s\n' "$name"
    pass=$((pass + 1))
  else
    printf '  ✗ %s\n' "$name"
    printf '      %s\n' "${out:-（no output)}"
    fail=$((fail + 1))
  fi
}

# --- helpers ---------------------------------------------------------------
# HTTP status only. `--max-time` so a hung origin fails the check instead of the job's 6h timeout.
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1"; }

expect_status() {
  local url="$1" want="$2" got
  got="$(status "$url")"
  [ "$got" = "$want" ] || {
    echo "expected HTTP $want from $url, got $got"
    return 1
  }
}

# Follows no redirects: we assert the redirect ITSELF, since "did the app redirect an anonymous
# visitor to login" is the security-relevant behaviour, not "did we eventually reach some 200".
expect_redirect_to() {
  local url="$1" want="$2" loc code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url")"
  loc="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 20 "$url")"
  case "$code" in
  30[1278]) ;;
  *)
    echo "expected a redirect from $url, got HTTP $code"
    return 1
    ;;
  esac
  case "$loc" in
  *"$want"*) ;;
  *)
    echo "expected the redirect from $url to land on *$want*, got '$loc'"
    return 1
    ;;
  esac
}

body_contains() {
  local url="$1" want="$2" body
  body="$(curl -fsS --max-time 20 "$url")" || {
    echo "request to $url failed"
    return 1
  }
  case "$body" in
  *"$want"*) ;;
  *)
    echo "expected the response from $url to contain '$want'"
    return 1
    ;;
  esac
}

header_is() {
  local url="$1" name="$2" want="$3" got
  got="$(curl -sSI --max-time 20 "$url" | tr -d '\r' | awk -v h="$(echo "$name" | tr 'A-Z' 'a-z')" \
    'BEGIN{IGNORECASE=1} tolower($1)==h":"{sub($1 FS,""); print}' | tail -1 | xargs)"
  [ "$got" = "$want" ] || {
    echo "expected header $name: $want on $url, got '${got:-<absent>}'"
    return 1
  }
}

# --- wait for the rollout --------------------------------------------------
# Fly replaces machines one at a time; the first request after a deploy can land on one that is
# still booting. Retry readiness only — once the API is up, everything else should answer at once.
printf 'Waiting for %s to report ready…\n' "$API_URL"
ready=""
for i in $(seq 1 15); do
  if curl -fsS --max-time 15 "$API_URL/health/ready" 2>/dev/null | grep -q '"db":"up"'; then
    ready=1
    printf 'Ready after %ss.\n\n' "$(((i - 1) * 5))"
    break
  fi
  sleep 5
done
[ -n "$ready" ] || {
  echo "::error::API never reported ready at $API_URL/health/ready — check \`fly logs\`."
  exit 1
}

# --- API -------------------------------------------------------------------
echo "API  $API_URL"
check "liveness responds" expect_status "$API_URL/health" 200
check "readiness reports the database up" body_contains "$API_URL/health/ready" '"db":"up"'

# The single most valuable API assertion: an unauthenticated call to a protected route must be 401.
# A 500 means the app booted but something below the guard is broken; a 200 would mean the global
# auth guard is not applied at all — the difference between a healthy deploy and a data breach.
check "protected route rejects anonymous callers (401)" expect_status "$API_URL/connections" 401

# Baseline security headers (docs/13). Cheap to assert, and silently lost if the proxy or the
# Fastify hook is ever reordered.
check "sends x-content-type-options" header_is "$API_URL/health" "x-content-type-options" "nosniff"
check "sends x-frame-options" header_is "$API_URL/health" "x-frame-options" "DENY"

# --- Web -------------------------------------------------------------------
echo
echo "Web  $WEB_URL"
# The exact check whose absence caused the outage: a dedicated endpoint that returns 200 without
# redirecting and without touching a downstream, so an API or Supabase outage can't also evict the
# frontend from the load-balancer pool.
check "health endpoint returns 200 (not a redirect)" expect_status "$WEB_URL/api/health" 200

# An anonymous visitor must be bounced to login — proves middleware runs and sessions are enforced.
check "anonymous root redirects to login" expect_redirect_to "$WEB_URL/" "/login"
check "anonymous dashboard redirects to login" expect_redirect_to "$WEB_URL/dashboard" "/login"

# The login page must actually RENDER, not just 200. A blank 200 is what a broken RSC boundary or a
# missing NEXT_PUBLIC_* build arg looks like — both have shipped before and both are invisible to
# `next build`. Asserting on real markup is what separates "served bytes" from "served the app".
check "login page renders" body_contains "$WEB_URL/login" "<html"
check "login page is really the login page" body_contains "$WEB_URL/login" "Atlas"

# --- verdict ---------------------------------------------------------------
echo
printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || {
  echo "::error::Post-deploy smoke test failed — production is serving incorrectly."
  exit 1
}
echo "Production is serving correctly."
