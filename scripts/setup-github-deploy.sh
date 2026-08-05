#!/usr/bin/env bash
#
# One-time: wire GitHub Actions to deploy to Fly on every green push to main.
#
#   bash scripts/setup-github-deploy.sh
#
# Also the way to ROTATE the Fly token later — re-running replaces the secret.
#
# Sets one secret and four variables:
#   secret   FLY_API_TOKEN               org-scoped Fly token (see note below)
#   var      FLY_DEPLOY_ENABLED=true     the switch release.yml's deploy job checks
#   var      NEXT_PUBLIC_API_URL         \
#   var      NEXT_PUBLIC_SUPABASE_URL     >  compiled into the browser bundle at build time
#   var      NEXT_PUBLIC_SUPABASE_ANON_KEY/
#
# Why the NEXT_PUBLIC_* ones are VARIABLES, not secrets: they ship to every browser that loads the
# app, so they aren't private. Storing them as secrets would imply otherwise and make them harder to
# read back. The Supabase SERVICE ROLE key is the opposite and must never appear here.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }

command -v fly >/dev/null || die "flyctl not installed"
command -v gh  >/dev/null || die "GitHub CLI not installed — brew install gh"
fly auth whoami >/dev/null 2>&1 || die "Not logged in to Fly — fly auth login"
gh auth status  >/dev/null 2>&1 || die "Not logged in to GitHub — gh auth login"
[ -f .env ] || die "No .env (the NEXT_PUBLIC_* values come from it)"

app_name() { grep -E '^app = ' "$1" | head -1 | sed 's/.*"\(.*\)".*/\1/'; }
API_APP="$(app_name fly.toml)"
API_URL="${ATLAS_API_URL:-https://${API_APP}.fly.dev}"

set -a; . ./.env; set +a
[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}"      ] || die "NEXT_PUBLIC_SUPABASE_URL missing from .env"
[ -n "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ] || die "NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env"

echo "Repo: $(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo

# ── the Fly token ────────────────────────────────────────────────────────────
# ORG-scoped, not app-scoped. `fly tokens create deploy` is tied to ONE app, so it would deploy the
# API and then fail on the web app — the deploy job needs both. Default expiry is ~20 years.
# `-j` puts flyctl in non-interactive mode, so it can't prompt for the organization and fails with
# "argument must be specified when not running interactively" — the org has to be passed explicitly.
# `fly orgs list --json` returns {"<slug>": "<display name>"}; take the first slug, or override with
# FLY_ORG=<slug> for a multi-org account.
FLY_ORG="${FLY_ORG:-$(fly orgs list --json 2>/dev/null | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { process.stdout.write(Object.keys(JSON.parse(s))[0] ?? ""); } catch { process.stdout.write(""); }
  })')}"
[ -n "$FLY_ORG" ] || die "Couldn't determine your Fly org — re-run with FLY_ORG=<slug> (see: fly orgs list)"

echo "Creating an org-scoped Fly deploy token (org: $FLY_ORG)…"
TOKEN_JSON="$(fly tokens create org -j -o "$FLY_ORG" -n 'atlas github actions')" || die "Couldn't create the token"
TOKEN="$(printf '%s' "$TOKEN_JSON" | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    try { const o = JSON.parse(s); process.stdout.write(o.token ?? o.Token ?? ""); }
    catch { process.stdout.write(""); }
  })')"
[ -n "$TOKEN" ] || die "Token came back empty — run 'fly tokens create org' by hand and set FLY_API_TOKEN yourself"

# Piped straight in: the token is never echoed to the terminal or written to disk.
printf '%s' "$TOKEN" | gh secret set FLY_API_TOKEN
unset TOKEN TOKEN_JSON
ok "secret FLY_API_TOKEN"

# ── the variables ────────────────────────────────────────────────────────────
gh variable set NEXT_PUBLIC_API_URL           --body "$API_URL"                       >/dev/null
gh variable set NEXT_PUBLIC_SUPABASE_URL      --body "$NEXT_PUBLIC_SUPABASE_URL"      >/dev/null
gh variable set NEXT_PUBLIC_SUPABASE_ANON_KEY --body "$NEXT_PUBLIC_SUPABASE_ANON_KEY" >/dev/null
ok "variables NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"

# Last, so nothing deploys until everything above is in place.
gh variable set FLY_DEPLOY_ENABLED --body "true" >/dev/null
ok "variable FLY_DEPLOY_ENABLED=true  (deploys are now ON)"

echo
gh secret list
gh variable list

cat <<NOTE

Done. Every push to main now: CI gates → publish images to GHCR → deploy API (migrations first)
→ deploy web → assert /health/ready.

To pause deploys without touching anything else:
    gh variable set FLY_DEPLOY_ENABLED --body false

To require your approval before each deploy:
    GitHub → Settings → Environments → production → Required reviewers
    (the deploy job already declares \`environment: production\`)

To rotate the Fly token: re-run this script. Old tokens: fly tokens list / fly tokens revoke.
NOTE
