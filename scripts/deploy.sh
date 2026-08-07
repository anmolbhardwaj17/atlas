#!/usr/bin/env bash
#
# Deploy Atlas to Fly.io — API and web, in the right order, with verification between.
#
#   pnpm run deploy:fly              # both
#   pnpm run deploy:fly -- --api     # API only
#   pnpm run deploy:fly -- --web     # web only
#   pnpm run deploy:fly -- --yes     # no confirmation prompt
#
# Order is not arbitrary. The API goes first because its release_command applies migrations, and
# because the web build BAKES the API's URL into the browser bundle — so pointing the frontend at an
# API that isn't up yet ships a broken bundle that only a rebuild can fix. If the API fails, the web
# deploy is skipped rather than shipped against a broken backend.
#
# App names come from fly.toml / fly.web.toml rather than being hard-coded here, so renaming an app
# means editing one line in one file and this script follows.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

DEPLOY_API=true
DEPLOY_WEB=true
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --api|--api-only) DEPLOY_WEB=false ;;
    --web|--web-only) DEPLOY_API=false ;;
    --yes|-y)         ASSUME_YES=true ;;
    -h|--help)        sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 1 ;;
  esac
done

say()  { printf '\n\033[1m── %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── preflight ────────────────────────────────────────────────────────────────
command -v fly >/dev/null || die "flyctl not installed — brew install flyctl"
fly auth whoami >/dev/null 2>&1 || die "Not logged in to Fly — run: fly auth login"
[ -f .env ] || die "No .env at $REPO (the web build reads NEXT_PUBLIC_* from it)"

# Single source of truth for app names.
app_name() { grep -E '^app = ' "$1" | head -1 | sed 's/.*"\(.*\)".*/\1/'; }
API_APP="$(app_name fly.toml)"
WEB_APP="$(app_name fly.web.toml)"
[ -n "$API_APP" ] && [ -n "$WEB_APP" ] || die "Couldn't read app names from fly.toml / fly.web.toml"

# The URL the browser bundle will be compiled against. Override for a custom domain:
#   ATLAS_API_URL=https://api.example.com pnpm run deploy:fly
API_URL="${ATLAS_API_URL:-https://${API_APP}.fly.dev}"
WEB_URL="${ATLAS_WEB_URL:-https://${WEB_APP}.fly.dev}"

set -a; . ./.env; set +a
SUPA_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
SUPA_ANON="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"

if $DEPLOY_WEB; then
  [ -n "$SUPA_URL"  ] || die "NEXT_PUBLIC_SUPABASE_URL missing from .env"
  [ -n "$SUPA_ANON" ] || die "NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env"
  # Baking a localhost API URL into the bundle is the classic way to ship a frontend that loads
  # perfectly and fails every request. .env holds the LOCAL value, so this is a live hazard.
  case "$API_URL" in
    *localhost*|*127.0.0.1*) die "API_URL is $API_URL — that would be compiled into the browser bundle." ;;
    https://*) ;;
    *) die "API_URL must be https:// (got $API_URL)" ;;
  esac
fi

# Deploying uncommitted work means what's running can't be reproduced from git. Worth a pause.
DIRTY=""
git diff --quiet && git diff --cached --quiet || DIRTY="yes"

say "Atlas → Fly"
printf '  API   %s  %s\n' "$($DEPLOY_API && echo 'deploy' || echo 'skip  ')" "$API_URL"
printf '  Web   %s  %s\n' "$($DEPLOY_WEB && echo 'deploy' || echo 'skip  ')" "$WEB_URL"
[ -n "$DIRTY" ] && printf '\n\033[33m  ! uncommitted changes — the deploy will include them, but git won'"'"'t match production\033[0m\n'

if ! $ASSUME_YES; then
  printf '\nProceed? [y/N] '
  read -r reply
  case "$reply" in [yY]*) ;; *) echo "Aborted."; exit 0 ;; esac
fi

# ── API ──────────────────────────────────────────────────────────────────────
if $DEPLOY_API; then
  say "1/2  API → $API_APP  (migrations run first, and abort the rollout if they fail)"
  fly deploy --config fly.toml

  printf '\nWaiting for %s/health/ready …\n' "$API_URL"
  for i in $(seq 1 15); do
    if curl -fsS -m 10 "$API_URL/health/ready" 2>/dev/null | grep -q '"db":"up"'; then
      ok "API healthy (database reachable)"; break
    fi
    printf '  attempt %s/15\n' "$i"; sleep 8
    [ "$i" = 15 ] && die "API never reported ready. Check: fly logs -a $API_APP"
  done
fi

# ── web ──────────────────────────────────────────────────────────────────────
if $DEPLOY_WEB; then
  # Even on --web, refuse to compile against a dead API — the URL is baked in, not configurable later.
  if ! curl -fsS -m 10 "$API_URL/health/ready" >/dev/null 2>&1; then
    die "$API_URL is not serving. Deploy the API first, or fix it — its URL gets compiled into the web bundle."
  fi

  say "2/2  Web → $WEB_APP"
  echo "  NEXT_PUBLIC_API_URL           = $API_URL"
  echo "  NEXT_PUBLIC_SUPABASE_URL      = $SUPA_URL"
  echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY = (${#SUPA_ANON} chars from .env)"
  echo "  (build-time — changing any of these needs a redeploy, not a restart)"
  echo
  fly deploy --config fly.web.toml \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPA_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPA_ANON" \
    --build-arg NEXT_PUBLIC_API_URL="$API_URL"

  printf '\nWaiting for %s/api/health …\n' "$WEB_URL"
  for i in $(seq 1 15); do
    if curl -fsS -m 10 "$WEB_URL/api/health" >/dev/null 2>&1; then
      ok "Web healthy"; break
    fi
    printf '  attempt %s/15\n' "$i"; sleep 8
    [ "$i" = 15 ] && die "Web never reported ready. Check: fly logs -a $WEB_APP"
  done
fi

# Both liveness probes above only prove each app answers *something*. Run the full smoke test so a
# manual deploy gets exactly the same verdict CI gives an automated one — otherwise the path a human
# uses under pressure is the one with the weaker check. Only meaningful when both halves went out.
if $DEPLOY_API && $DEPLOY_WEB; then
  say "Smoke-testing the live deployment"
  API_URL="$API_URL" WEB_URL="$WEB_URL" bash "$(dirname "$0")/smoke.sh" \
    || die "Deploy completed but production is serving incorrectly (see the failures above)."
fi

say "Done"
$DEPLOY_API && echo "  API  $API_URL"
$DEPLOY_WEB && echo "  Web  $WEB_URL"
cat <<NOTE

If the web hostname ever changes, two things must follow it:
  • CORS      fly secrets set -a $API_APP WEB_ORIGIN="$WEB_URL"
  • Auth      Supabase → Authentication → URL Configuration → Redirect URLs
              must contain $WEB_URL/** (and http://localhost:4291/** for local dev)
NOTE
