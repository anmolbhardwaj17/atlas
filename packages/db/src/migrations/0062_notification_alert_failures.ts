// Track consecutive failed alert deliveries per notification channel. Before this, the dispatcher
// advanced `last_alert_at` even when a webhook delivery failed (429/500/DNS blip), permanently
// dropping that "your resource went unhealthy" alert. Now a failed delivery does NOT advance the
// watermark (so the next tick retries), and after N consecutive failures the channel is disabled
// (so a permanently-broken webhook can't re-send + re-run autoDiagnose forever). Org-scoped table;
// column inherits the existing RLS policy.

export const up: string[] = [
  `ALTER TABLE notification_channels ADD COLUMN IF NOT EXISTS alert_failures int NOT NULL DEFAULT 0`,
];

export const down: string[] = [
  `ALTER TABLE notification_channels DROP COLUMN IF EXISTS alert_failures`,
];
