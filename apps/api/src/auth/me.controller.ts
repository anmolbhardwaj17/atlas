import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import type { Role } from "@atlas/db";
import { AuthGuard } from "./auth.guard";
import { UserMirrorService } from "./user-mirror.service";
import { MembershipService } from "./membership.service";
import { parseBody } from "../common/validation";
import type { AuthedRequest } from "./auth.types";
import type { MirroredUser } from "./user-mirror.service";

const UpdateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    avatarUrl: z.string().trim().url().max(500).optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.avatarUrl !== undefined, {
    message: "Nothing to update.",
  });

interface MeMembership {
  orgId: string;
  orgName: string;
  orgSlug: string;
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
    const user = await this.users.updateProfile(claims.userId, patch);
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
        role: o.role,
      })),
      defaultOrgId: orgs[0]?.id ?? null,
    };
  }
}
