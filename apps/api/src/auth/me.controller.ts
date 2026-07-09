import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { Role } from "@atlas/db";
import { AuthGuard } from "./auth.guard";
import { UserMirrorService } from "./user-mirror.service";
import { MembershipService } from "./membership.service";
import { ImageUploadService } from "../core/image-upload.service";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "./auth.types";
import type { MirroredUser } from "./user-mirror.service";

/** Uploaded avatars live in the public `avatars` bucket, keyed by user id. */
const AVATAR_BUCKET = "avatars";

const UpdateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    // A photo URL OR an avvvatars descriptor ("avv:character" / "avv:shape:<seed>").
    avatarUrl: z.string().trim().min(1).max(500).optional(),
    // A newly-uploaded photo as a base64 `data:` URL — uploaded to storage, then stored as avatarUrl.
    avatar: z.string().trim().min(1).max(3_000_000).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.avatarUrl !== undefined || v.avatar !== undefined, {
    message: "Nothing to update.",
  });

interface MeMembership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgLogoUrl: string | null;
  role: Role;
}
interface MeResponse {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  memberships: MeMembership[];
  defaultOrgId: string | null;
}

/**
 * The post-login landing call (docs/12 §2.1, docs/08 §6). Verifies the session,
 * mirrors the identity, and returns the user + memberships (docs/08 §6 shape; the
 * global interceptor wraps it as `{ data }`). A brand-new user has zero memberships
 * (onboarding = create/accept an org, F1.6) - still 200.
 */
@Controller("me")
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    private readonly users: UserMirrorService,
    private readonly memberships: MembershipService,
    private readonly images: ImageUploadService,
  ) {}

  @Get()
  async me(@Req() req: AuthedRequest): Promise<MeResponse> {
    const claims = req.auth;
    if (!claims) throw new Error("auth context missing (guard should have set it)");
    const user = await this.users.ensureUser(claims);
    return this.build(user, claims.emailVerified);
  }

  /** Update the signed-in user's own profile (currently just their display name). */
  @Patch()
  async update(@Req() req: AuthedRequest, @Body() body: unknown): Promise<MeResponse> {
    const claims = req.auth;
    if (!claims) throw new Error("auth context missing (guard should have set it)");
    await this.users.ensureUser(claims); // make sure the row exists
    const patch = parseBody(UpdateMeSchema, body);
    // A newly-uploaded photo (data URL) is stored first; its public URL becomes the avatar.
    const avatarUrl = patch.avatar
      ? await this.images.upload(AVATAR_BUCKET, claims.userId, patch.avatar)
      : patch.avatarUrl;
    const profilePatch: { name?: string; avatarUrl?: string } = {};
    if (patch.name !== undefined) profilePatch.name = patch.name;
    if (avatarUrl !== undefined) profilePatch.avatarUrl = avatarUrl;
    const user = await this.users.updateProfile(claims.userId, profilePatch);
    return this.build(user, claims.emailVerified);
  }

  private async build(user: MirroredUser, emailVerified: boolean): Promise<MeResponse> {
    const orgs = await this.memberships.listForUser(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified,
      memberships: orgs.map((o) => ({
        orgId: o.id,
        orgName: o.name,
        orgSlug: o.slug,
        orgLogoUrl: o.logoUrl,
        role: o.role,
      })),
      defaultOrgId: orgs[0]?.id ?? null,
    };
  }
}
