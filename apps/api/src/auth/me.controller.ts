import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Role } from "@atlas/db";
import { AuthGuard } from "./auth.guard";
import { UserMirrorService } from "./user-mirror.service";
import { MembershipService } from "./membership.service";
import type { AuthedRequest } from "./auth.types";

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
    const orgs = await this.memberships.listForUser(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified: claims.emailVerified,
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
