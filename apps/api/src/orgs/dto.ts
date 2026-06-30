import { z } from "zod";
import type { Role } from "@atlas/db";

/** Request schemas (docs/08 §7). `.strict()` rejects unknown fields (P8). */
export const CreateOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .regex(/^[a-z0-9-]{3,40}$/, "must be 3–40 chars of a-z, 0-9, or -")
      .optional(),
  })
  .strict();
export type CreateOrgBody = z.infer<typeof CreateOrgSchema>;

export const RenameOrgSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export type RenameOrgBody = z.infer<typeof RenameOrgSchema>;

export const ChangeRoleSchema = z.object({ role: z.enum(["Owner", "Admin", "Member"]) }).strict();
export type ChangeRoleBody = z.infer<typeof ChangeRoleSchema>;

// Invites never grant Owner (docs/12 §6.2, BR — Owner only via transfer).
export const CreateInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    role: z.enum(["Admin", "Member"]),
  })
  .strict();
export type CreateInviteBody = z.infer<typeof CreateInviteSchema>;

/** Response DTOs (explicit allow-list; camelCase — docs/08 §4 DD-2). */
export interface OrgDto {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  createdAt: string;
}
export interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  status: string;
  joinedAt: string;
}
export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  status: string;
  expiresAt: string;
  createdAt: string;
}
