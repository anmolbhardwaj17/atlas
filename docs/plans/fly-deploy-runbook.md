# Atlas — Fly.io deploy runbook (2026-08-05)

The exact commands for a first production deploy on Fly (`docs/17` DD-2a). The general checklist is
`deployment-checklist.md`; this is the platform-specific half. Everything the pipeline can do is
already automated — what's below is the one-time setup only you can do.

**Target shape** (~$9/month):

```
Cloudflare (DNS · CDN · TLS · WAF — free)
   ├── app.<domain>  → atlas-web   Fly syd, 512MB
   └── api.<domain>  → atlas-api   Fly syd, 1GB  ← API + BullMQ worker + schedulers, one machine
                                     ├── Supabase Postgres (ap-southeast-2 — same region, on purpose)
                                     └── Upstash Redis (rediss://)
```

One machine runs the API, worker and schedulers together. That's safe because the cadence ticks are
leader-locked via Postgres advisory locks — adding a second machine later won't double-send alerts
or double-spend on `autoDiagnose`. It's a config change, not a rewrite.

---

## 1. Accounts and CLI (~5 min)

```sh
brew install flyctl            # or: curl -L https://fly.io/install.sh | sh
fly auth signup                # or `fly auth login`
```

Fly requires a card on file even on small workloads; there's no true free tier for always-on
machines. Budget ~$9/month for the shape above.

## 2. Redis

Create an **Upstash Redis** database (their free tier is enough to start) in the region closest to
Sydney. Copy the **`rediss://` TCP URL** — not the REST URL. BullMQ needs the Redis protocol and
blocking commands; `bullmq-queue.ts` already sets `maxRetriesPerRequest: null` and handles TLS, so
no code change is needed.

> If the free tier's daily command limit bites (the health poller and queue are chatty), either move
> to Upstash pay-as-you-go — cents per month at this volume — or run Redis as a third Fly machine
> with a small volume and `appendonly yes`.

## 3. Create the two Fly apps

**Run these from the repo root** (`cd ~/Desktop/code/atlas`), not from your home directory.

```sh
fly apps create atlas-api
fly apps create atlas-web
```

That's all this step needs to do: register the two names. `fly deploy` in step 5 reads the region,
VM size, health checks and release command from the `fly.toml` / `fly.web.toml` already in the repo.

> ⚠️ **Do not use `fly launch` here.** It's the greenfield command: it scans the working directory,
> guesses a framework, and **generates or overwrites `fly.toml`**. Run from the wrong directory it
> reports things like `Creating app in /Users/apple` and `Detected a NextJS app` — it found your home
> folder, not this project. Run from the *right* directory it's still wrong for us, because it would
> happily rewrite hand-authored config where individual lines are load-bearing:
> `auto_stop_machines = "off"` (without it the schedulers silently stop) and `release_command`
> (without it migrations never run). `fly apps create` touches no files.

If those names are taken, pick your own and update `app =` in `fly.toml` / `fly.web.toml` to match.

### If a `fly` command fails with `Post "https://api.fly.io/graphql": EOF`

A dropped connection to Fly's API, not a problem with your config — nothing was created, so just
retry. If it repeats: `fly version upgrade`, then check for a VPN/proxy/corporate DNS in the way
(`curl -sS -o /dev/null -w '%{http_code}\n' https://api.fly.io/graphql` should print a number, not
hang). `fly auth whoami` confirms your session is still good.

## 4. Set the API secrets

Everything the app treats as sensitive. `fly secrets set` stages them and restarts the app on next
deploy.

```sh
fly secrets set -a atlas-api \
  DATABASE_URL="postgres://atlas_app:<pw>@<host>:5432/postgres" \
  DATABASE_URL_MIGRATE="postgres://postgres:<pw>@<host>:5432/postgres" \
  REDIS_URL="rediss://default:<pw>@<host>:6379" \
  SECRET_ENCRYPTION_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" \
  SUPABASE_URL="https://<project>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
  SUPABASE_ANON_KEY="<anon-key>" \
  ANTHROPIC_API_KEY="<sk-ant-...>" \
  WEB_ORIGIN="https://app.<your-domain>" \
  PUBLIC_API_URL="https://api.<your-domain>"
```

Notes that will save you an outage:

- **Two different database URLs, deliberately.** `DATABASE_URL` is the restricted `atlas_app` role
  the app runs as — it cannot do DDL and RLS applies to it. `DATABASE_URL_MIGRATE` is the owner role
  used only by the release-command migration. The app **refuses to boot** if its role can bypass RLS
  (R8 fail-closed), so don't be tempted to use one URL for both.
- **`SECRET_ENCRYPTION_KEY` is not recoverable.** It decrypts every stored connector credential. Lose
  it and every customer has to reconnect every source. Put a copy in a password manager now.
- **Boot fails loudly if any of these are missing** — that's by design. If the release fails at
  startup, `fly logs -a atlas-api` will name the exact variable.
- Use the **session pooler** connection string from Supabase, not the direct one, and keep
  `PG_POOL_MAX` (16) under its per-client limit.

## 5. First deploy

```sh
fly deploy                       # API — runs migrations first, then rolls
fly deploy -c fly.web.toml \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>" \
  --build-arg NEXT_PUBLIC_API_URL="https://api.<your-domain>"
```

The API deploy runs `node node_modules/@atlas/db/dist/migrate.js` in a temporary machine **before**
the new version takes traffic; a non-zero exit aborts the rollout, so a bad migration never leaves
you with a half-deployed app.

> ⚠️ **The `--build-arg`s are not optional and not runtime config.** Next inlines `NEXT_PUBLIC_*`
> into the JavaScript the browser downloads. Setting them as Fly secrets or `[env]` does nothing.
> Changing one needs a **rebuild**, not a restart. Omitting them yields a frontend that loads
> perfectly and talks to `localhost:4290`.

Verify:

```sh
curl -fsS https://atlas-api.fly.dev/health/ready     # {"status":"ready","db":"up"}
fly logs -a atlas-api
```

## 6. Provision the `atlas_app` role (once, if you haven't)

Migrations run as the owner; the app needs its restricted role to exist:

```sh
DATABASE_URL_MIGRATE="<owner-url>" ATLAS_APP_PASSWORD="<pw>" \
  pnpm --filter @atlas/db run setup:app-role
```

## 7. Turn on automatic deploys

In GitHub → Settings:

| Kind | Name | Value |
|---|---|---|
| Secret | `FLY_API_TOKEN` | `fly tokens create deploy -x 999999h` |
| Variable | `FLY_DEPLOY_ENABLED` | `true` |
| Variable | `NEXT_PUBLIC_API_URL` | `https://api.<your-domain>` |
| Variable | `NEXT_PUBLIC_SUPABASE_URL` | `https://<project>.supabase.co` |
| Variable | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key |

Variables, not secrets, for the `NEXT_PUBLIC_*` values — they ship to every browser regardless, and
keeping them out of the secret store makes that obvious. **Never** put the service-role key here.

After that, every green push to `main` publishes images to GHCR and rolls Fly automatically. Until
`FLY_DEPLOY_ENABLED=true` the deploy job is skipped and everything else still runs.

## 8. Custom domains + Cloudflare

```sh
fly certs add api.<your-domain> -a atlas-api
fly certs add app.<your-domain> -a atlas-web
```

In Cloudflare DNS, add the records Fly prints. **Set them to "DNS only" (grey cloud) until the
certificates validate**, then switch to proxied (orange cloud) for CDN/WAF. Proxying before
validation blocks the ACME challenge and the cert never issues.

With Cloudflare proxying on, use **Full (strict)** SSL — Fly serves a valid certificate, and
"Flexible" would leave the Cloudflare→Fly hop unencrypted.

Then update `WEB_ORIGIN` / `PUBLIC_API_URL` secrets and rebuild the web image with the real
`NEXT_PUBLIC_API_URL`.

## 9. Turn on the schedulers

`fly.toml` ships with health polling **off** (`HEALTH_INTERVAL_MINUTES = "0"`) so the first deploy
is quiet. Once the graph is populated and you want live incidents:

```sh
fly secrets set -a atlas-api HEALTH_INTERVAL_MINUTES=2
```

## 10. Operating notes

| Task | Command |
|---|---|
| Logs | `fly logs -a atlas-api` |
| Shell | `fly ssh console -a atlas-api` |
| Scale memory | `fly scale memory 2048 -a atlas-api` |
| Add a machine | `fly scale count 2 -a atlas-api` — safe: ticks are leader-locked |
| Roll back | `fly releases -a atlas-api` then `fly deploy --image <previous>` |
| Metrics | `curl -H "Authorization: Bearer $METRICS_TOKEN" https://api.<domain>/metrics` |

**Do not set `auto_stop_machines` on the API.** The schedulers are `setInterval` timers inside the
process, so a suspended machine stops syncing, health-polling and notifying — while still answering
every request you make by hand, which makes it look healthy.

**Set `METRICS_TOKEN`** once the API is internet-facing, or `/metrics` is world-readable.

## Still outstanding (not Fly-specific)

- **ToS / Privacy Policy are placeholder boilerplate** — needs counsel before paying customers, and
  it gates Google OAuth verification and Slack/Discord app review, both of which have lead time.
- **DR drill** — restore Postgres to a scratch project, rebuild search, verify graph parity.
  `docs/17` §10 commits to RPO ≤1h / RTO ≤4h and says untested backups don't count.
