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
export type ConnectionProvider =
  "aws" | "github" | "azure" | "gcp" | "bitbucket" | "gitlab" | "datadog";
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

// Knowledge / graph (docs/04 §5.3–5.4, F2.3). The graph is the product (P1).
export type Confidence = "observed" | "inferred-high" | "inferred-low";
export type NodeStatus = "active" | "stale" | "deleted";
export type EdgeOrigin = "observed" | "inferred";
export type EdgeStatus = "active" | "retired";

export interface NodeKindRow {
  kind: string;
  provider: string;
  category: string;
  description: string;
}

export interface InferenceRuleRow {
  id: string;
  key: string;
  version: number;
  name: string;
  description: string;
  produces_type: string;
  confidence_tier: "inferred-high" | "inferred-low";
  enabled: boolean;
  created_at: Date;
}

export interface NodeRow {
  id: string;
  org_id: string;
  connection_id: string;
  urn: string;
  kind: string;
  name: string | null;
  provider: string;
  region: string | null;
  account_ref: string | null;
  tags: Record<string, unknown>;
  attributes: Record<string, unknown>;
  status: NodeStatus;
  confidence: Confidence;
  first_seen: Date;
  last_seen: Date;
  last_sync_run_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface RawSnapshotRow {
  id: string;
  org_id: string;
  node_id: string | null;
  storage_ref: string;
  content_hash: string;
  sync_run_id: string | null;
  captured_at: Date;
}

export interface ProvenanceRow {
  id: string;
  org_id: string;
  source: string;
  sync_run_id: string | null;
  observed_at: Date;
  confidence: Confidence;
  inference_rule_id: string | null;
  evidence: Record<string, unknown>;
  raw_snapshot_id: string | null;
}

export interface EdgeRow {
  id: string;
  org_id: string;
  from_node_id: string;
  to_node_id: string;
  type: string;
  origin: EdgeOrigin;
  confidence: Confidence;
  provenance_id: string;
  inference_rule_id: string | null;
  status: EdgeStatus;
  first_seen: Date;
  last_seen: Date;
  last_sync_run_id: string | null;
  retired_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Append-only audit log (docs/13 §8, migration 0014). Org-scoped; INSERT+SELECT only. */
export interface AuditEventRow {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  request_id: string | null;
  created_at: Date;
}

/** A change-timeline event attached to a node (operational-intelligence Phase C). */
export type NodeEventKind =
  "deploy" | "config_change" | "pr_merged" | "alarm_transition" | "health_transition";

export interface NodeEventRow {
  id: string;
  org_id: string;
  node_id: string;
  kind: NodeEventKind;
  occurred_at: Date;
  actor: string | null;
  title: string;
  evidence: Record<string, unknown>;
  source: string;
  dedupe_key: string;
  created_at: Date;
}
