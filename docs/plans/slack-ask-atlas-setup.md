# Slack "Ask Atlas" — go-live setup runbook

> **Status: code-complete (2026-07-16).** Everything is built, tested, and merged to `main`. The
> only remaining work is registering the Slack app + setting env + deploying (a public webhook URL
> is required, which is why this waits on deployment). Do the steps below when you're ready.

## What it is

Ask Atlas from Slack: a user types `/atlas <question>` in any channel and gets back a **grounded,
cited** answer from your graph — the same answer engine as the in-app Ask, now visible to the whole
channel. Read-only; org-scoped; honest-absence preserved (a refusal, never a fabrication).

## One-time setup

### 1. Create the Slack app — https://api.slack.com/apps → "Create New App" → "From scratch"

Pick the workspace, then configure:

| Setting | Value |
|---|---|
| **Slash Commands** → Create New Command | Command: `/atlas` · Request URL: `https://<PUBLIC_API_URL>/slack/command` · Short description: "Ask Atlas about your infrastructure" · Usage hint: `what depends on orders-db?` |
| **OAuth & Permissions** → Redirect URLs | `https://<PUBLIC_API_URL>/slack/oauth/callback` |
| **OAuth & Permissions** → Bot Token Scopes | `commands` |
| **Basic Information** | Copy the **Client ID**, **Client Secret**, and **Signing Secret** |

> `PUBLIC_API_URL` = the internet-reachable origin of the Atlas **API** (not the web app). Every URL
> above must be HTTPS and publicly reachable — hence the deploy dependency.

### 2. Set env on the API

```
SLACK_CLIENT_ID=<from Basic Information>
SLACK_CLIENT_SECRET=<from Basic Information>
SLACK_SIGNING_SECRET=<from Basic Information>
PUBLIC_API_URL=https://<your-api-origin>
```

All optional/fail-closed: if any are unset, the `/slack` endpoints reject/no-op and the hub card
shows "Not configured on this deployment yet."

### 3. Deploy, then connect + test

1. Deploy the API (so the request/redirect URLs resolve).
2. In Atlas → **Integrations**, click **Add to Slack** (Admin only) → approve in Slack → you bounce
   back to the hub with a "Slack connected" toast.
3. In any Slack channel: `/atlas what depends on orders-db?` → an in-channel, cited answer.

## How it works (for reference)

- **Install binding (R8):** OAuth `state` is HMAC-signed and carries the initiating Atlas org; the
  callback binds the workspace `team_id` → that org in `slack_installations` (team_id UNIQUE). A
  workspace already bound to another org is **refused**, never silently re-pointed.
- **Inbound trust:** every `/slack/command` request is HMAC-verified against the signing secret
  (`v0:{ts}:{body}`) with a ±5-min replay guard — the signature IS the auth (no Atlas session).
- **Answer flow:** verify → resolve org from `team_id` (SECURITY DEFINER `app_slack_org`) → ack in
  <3s → run the org-scoped grounded answer async → post an `in_channel` Block Kit reply (with
  confidence + citation deep-links) to the request's `response_url`.
- **Secrets:** the bot token is stored via the encrypted SecretBroker (a `secret_ref`, never raw);
  disconnect shreds it.

## Code map

| Piece | File |
|---|---|
| Install table + resolver | `packages/db/src/migrations/0060_slack_installations.ts` |
| Signature verify | `apps/api/src/slack/slack-verify.ts` |
| Block Kit formatter | `apps/api/src/slack/slack-blocks.ts` |
| Service (OAuth, command, answer) | `apps/api/src/slack/slack.service.ts` |
| Public ingress | `apps/api/src/slack/slack.controller.ts` |
| Authed admin routes | `apps/api/src/slack/slack-admin.controller.ts` |
| Hub card | `apps/web/src/components/integrations/slack-ask-card.tsx` |
| Env | `packages/config/src/index.ts` (`SLACK_*`, `PUBLIC_API_URL`) |

## Follow-ups (not in v1)

- Per-org rate-limit on `/atlas` (Slack throttles, but a guard is cheap insurance).
- v2: `app_mention` / `chat.postMessage` using the stored bot token (thread replies, proactive posts).
- Discord + Teams — fast follow-ons on the same pipeline (`answerForIntegration` + a per-platform
  verify/format adapter).
