/**
 * Row types for the core platform tables (docs/04 §5.1) — plain TypeScript
 * interfaces describing what a SELECT returns. No ORM/query-builder; queries are
 * raw parameterized SQL via `pg` (docs/16 CS-6). Graph tables come in the G sprints.
 */

export type OrgStatus = "active" | "suspended" | "deleting";
export type UserStatus = "active" | "disabled";
export type Role = "Owner" | "Admin" | "Member";
export type MembershipStatus = "active" | "invited" | "revoked" | "requested";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";
export type AuthProvider = "google" | "password";

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: OrgStatus;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

export interface AuthIdentityRow {
  id: string;
  user_id: string;
  provider: AuthProvider;
  provider_subject: string | null;
  email_domain: string | null;
  password_hash: string | null;
  created_at: Date;
}

export interface MembershipRow {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
  status: MembershipStatus;
  created_at: Date;
  updated_at: Date;
}

export interface InvitationRow {
  id: string;
  org_id: string;
  email: string;
  role: Exclude<Role, "Owner">;
  token_hash: string;
  status: InvitationStatus;
  invited_by: string | null;
  created_at: Date;
  expires_at: Date;
}

// Ingest substrate (docs/04 §5.2, F2). `connections` = source links; `sync_runs` =
// crawl executions (the unit of freshness/history).
export type ConnectionProvider = "aws" | "github";
export type ConnectionStatus =
  "pending" | "verifying" | "connected" | "degraded" | "error" | "disconnected";
export type SyncRunType = "full" | "incremental" | "webhook";
export type SyncRunStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
export type SyncTrigger = "scheduled" | "manual" | "onboarding" | "webhook";

export interface ConnectionRow {
  id: string;
  org_id: string;
  provider: ConnectionProvider;
  display_name: string;
  status: ConnectionStatus;
  config: Record<string, unknown>;
  secret_ref: string | null;
  health: Record<string, unknown>;
  last_error: string | null;
  last_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface SyncRunRow {
  id: string;
  org_id: string;
  connection_id: string;
  type: SyncRunType;
  status: SyncRunStatus;
  trigger: SyncTrigger;
  checkpoint: Record<string, unknown>;
  stats: Record<string, unknown>;
  scope_result: Record<string, unknown>;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}
