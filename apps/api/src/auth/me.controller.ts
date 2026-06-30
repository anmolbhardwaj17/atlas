import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { UserMirrorService } from "./user-mirror.service";
import { MembershipService, type OrgMembership } from "./membership.service";
import type { AuthedRequest } from "./auth.types";
import type { MirroredUser } from "./user-mirror.service";

interface MeResponse {
  user: MirroredUser;
  emailVerified: boolean;
  orgs: OrgMembership[];
  activeOrg: OrgMembership | null;
}

/**
 * The post-login landing call (docs/12 §2.1). Verifies the session (AuthGuard),
 * mirrors the identity, and returns the user plus their org memberships. A
 * brand-new user has zero orgs (onboarding is F1.6) — this still returns 200.
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
      user,
      emailVerified: claims.emailVerified,
      orgs,
      activeOrg: orgs[0] ?? null,
    };
  }
}
