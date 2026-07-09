import { z } from "zod";
import type { Role } from "@atlas/db";

/** A logo upload: a base64 `data:` URL. Capped generously — base64 of a ~1.5 MB image is ~2 MB of
 *  chars; the service re-validates the decoded size + mime. */
const LogoDataUrl = z.string().trim().min(1).max(3_000_000);

/** Request schemas (docs/08 §7). `.strict()` rejects unknown fields (P8). */
export const CreateOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    slug: z
      .string()
      .regex(/^[a-z0-9-]{3,40}$/, "must be 3-40 chars of a-z, 0-9, or -")
      .optional(),
    logo: LogoDataUrl.optional(),
  })
  .strict();
export type CreateOrgBody = z.infer<typeof CreateOrgSchema>;

/** Update org identity: rename and/or set-or-remove the logo (`logo: null` clears it). */
export const UpdateOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    logo: z.union([LogoDataUrl, z.null()]).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.logo !== undefined, {
    message: "Nothing to update.",
  });
export type UpdateOrgBody = z.infer<typeof UpdateOrgSchema>;

export const ChangeRoleSchema = z.object({ role: z.enum(["Owner", "Admin", "Member"]) }).strict();
export type ChangeRoleBody = z.infer<typeof ChangeRoleSchema>;

// Invites never grant Owner (docs/12 §6.2, BR - Owner only via transfer).
export const CreateInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    role: z.enum(["Admin", "Member"]),
  })
  .strict();
export type CreateInviteBody = z.infer<typeof CreateInviteSchema>;

/** Response DTOs (explicit allow-list; camelCase - docs/08 §4 DD-2). */
export interface OrgDto {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
  logoUrl: string | null;
  createdAt: string;
}
export interface MemberDto {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
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
  /** The accept link — returned ONLY when the invite is first created, so the inviter can copy it
   *  (email delivery is the primary path). Never returned by `list` (the token isn't recoverable). */
  acceptUrl?: string;
}
