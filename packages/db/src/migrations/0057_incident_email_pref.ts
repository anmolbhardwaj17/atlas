// Per-user incident-email opt-out (#44 follow-up). Proactive incident alerts previously went to
// EVERY active member with no way to opt out. Mirror the existing `digest_opt_out` pattern with a
// per-membership `incident_email_opt_out` so a user can silence incident mail for one org while
// still using the app. The recipient query honours it; both prefs are now toggleable in-app.

export const up: string[] = [
  `ALTER TABLE memberships ADD COLUMN IF NOT EXISTS incident_email_opt_out boolean NOT NULL DEFAULT false`,
];

export const down: string[] = [
  `ALTER TABLE memberships DROP COLUMN IF EXISTS incident_email_opt_out`,
];
