/** Cookie the OrgSwitcher sets to pick the active org among a user's memberships; `requireShell`
 *  reads it server-side. In its own module (no server-only imports) so client + server can share it. */
export const ACTIVE_ORG_COOKIE = "atlas_active_org";

/** Window event fired after an org's identity (name/logo) changes, so the client OrgSwitcher —
 *  which self-fetches once on mount — re-pulls its data immediately instead of going stale. */
export const ORG_UPDATED_EVENT = "atlas:org-updated";
