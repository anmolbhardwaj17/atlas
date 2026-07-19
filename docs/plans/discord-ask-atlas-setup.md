# Discord "Ask Atlas" — go-live setup runbook

> **Status: code-complete (2026-07-19).** Built, tested, merged. The only remaining work is
> registering the Discord app + setting env + deploying (interactions need a public HTTPS endpoint).
> Transport: **HTTP interactions** (not the gateway) — chosen as the cheapest to run (native Node
> Ed25519, no `discord.js`, no persistent worker).

## What it is

`/atlas <question>` in any Discord channel → a grounded, cited answer from your graph (same engine as
the in-app Ask). Read-only, org-scoped, honest-absence preserved.

## One-time setup

### 1. Create the Discord app — https://discord.com/developers/applications → "New Application"

| Section | Value |
|---|---|
| **General Information** | Copy the **Application ID** and the **Public Key**. Set **Interactions Endpoint URL** = `https://<PUBLIC_API_URL>/discord/interactions` (Discord PINGs it to verify — our PONG handles it, so it must be deployed first). |
| **OAuth2** | Copy the **Client Secret**. Add redirect `https://<PUBLIC_API_URL>/discord/oauth/callback`. |
| **Bot** | Add a bot, copy its **Token** (used only to register the command below). |

### 2. Set env on the API

```
DISCORD_APPLICATION_ID=<Application ID>
DISCORD_PUBLIC_KEY=<Public Key>
DISCORD_CLIENT_SECRET=<OAuth2 Client Secret>
DISCORD_BOT_TOKEN=<Bot Token>
PUBLIC_API_URL=https://<your-api-origin>
```

All optional/fail-closed: unset ⇒ `/discord` endpoints reject/no-op, hub card shows "Not configured."

### 3. Register the `/atlas` slash command (one-time, via the API)

```bash
curl -X PUT "https://discord.com/api/v10/applications/$DISCORD_APPLICATION_ID/commands" \
  -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "atlas",
    "description": "Ask Atlas about your infrastructure",
    "options": [
      { "name": "question", "description": "e.g. what depends on orders-db?", "type": 3, "required": true }
    ]
  }'
```

(`type: 3` = STRING. Global commands can take up to ~1h to propagate; register as a guild command for
instant availability while testing: `.../applications/$APP_ID/guilds/$GUILD_ID/commands`.)

### 4. Deploy, connect + test

1. Deploy the API (so the interactions + redirect URLs resolve; Discord verifies the endpoint with a
   signed PING).
2. Atlas → **Integrations** → **Add to Discord** (Admin) → pick a server → bounce back with a toast.
3. In a channel: `/atlas question: what depends on orders-db?` → a cited answer.

## How it works (for reference)

- **Install binding (R8):** OAuth `state` is HMAC-signed (client secret) and carries the org; the
  callback binds `guild_id` → that org in `discord_installations` (guild_id UNIQUE). A guild bound to
  another org is **refused**.
- **Inbound trust:** every interaction is **Ed25519**-verified against the public key over
  `timestamp + rawBody` (native `crypto.verify`, SPKI-wrapped key). The signature IS the auth.
- **Answer flow:** verify → PING→PONG, or resolve org from `guild_id` → **defer** (type 5, beats the
  3s window) → org-scoped grounded answer async → `PATCH …/@original` (authorized by the interaction
  token; no bot token needed at answer time).

## Code map

| Piece | File |
|---|---|
| Install table + resolver | `packages/db/src/migrations/0061_discord_installations.ts` |
| Ed25519 verify | `apps/api/src/discord/discord-verify.ts` |
| Answer → embed | `apps/api/src/discord/discord-embeds.ts` |
| Service | `apps/api/src/discord/discord.service.ts` |
| Public ingress | `apps/api/src/discord/discord.controller.ts` |
| Authed admin routes | `apps/api/src/discord/discord-admin.controller.ts` |
| Hub card (shared w/ Slack) | `apps/web/src/components/integrations/chat-ask-card.tsx` |

## Follow-ups (not in v1)

- Per-org rate-limit on `/atlas`.
- v2: gateway mode / `app_mention`-style proactive posts using the bot token.
- Teams — the next fast follow-on on the same `answerForIntegration` pipeline.
