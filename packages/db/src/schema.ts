import type { Generated } from "kysely";

/**
 * Kysely table types for the core platform tables (docs/04 §5.1).
 * `Generated<T>` marks columns with DB-side defaults (optional on insert).
 * Graph tables (nodes/edges/...) are added in the G sprints.
 */

export type OrgStatus = "active" | "suspended" | "deleting";
export type UserStatus = "active" | "disabled";
export type Role = "Owner" | "Admin" | "Member";
export type MembershipStatus = "active" | "invited" | "revoked" | "requested";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";
export type AuthProvider = "google" | "password";

export interface OrganizationsTable {
  id: Generated<string>;
  slug: string;
  name: string;
  plan: Generated<string>;
  status: Generated<OrgStatus>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  name: string | null;
  avatar_url: string | null;
  status: Generated<UserStatus>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface AuthIdentitiesTable {
  id: Generated<string>;
  user_id: string;
  provider: AuthProvider;
  provider_subject: string | null;
  email_domain: string | null;
  password_hash: string | null;
  created_at: Generated<Date>;
}

export interface MembershipsTable {
  id: Generated<string>;
  org_id: string;
  user_id: string;
  role: Role;
  status: Generated<MembershipStatus>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InvitationsTable {
  id: Generated<string>;
  org_id: string;
  email: string;
  role: Exclude<Role, "Owner">;
  token_hash: string;
  status: Generated<InvitationStatus>;
  invited_by: string | null;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface Database {
  organizations: OrganizationsTable;
  users: UsersTable;
  auth_identities: AuthIdentitiesTable;
  memberships: MembershipsTable;
  invitations: InvitationsTable;
}
