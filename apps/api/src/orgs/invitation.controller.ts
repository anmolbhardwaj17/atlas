import { Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { ApiException } from "../common/errors";
import type { AuthedRequest } from "../auth/auth.types";
import { InvitationService } from "./invitation.service";
import type { OrgDto } from "./dto";
import type { Role } from "@atlas/db";

/**
 * Accept an invitation (docs/08 §7, docs/12 §6.2). Auth required — the invitee must
 * be signed in (with the invited email). Realized as a trailing `/accept` segment:
 * the documented `{token}:accept` colon-action can't be expressed for a *dynamic*
 * path param under Fastify routing, so dynamic-id actions use `/{action}` in code.
 */
@Controller("invitations")
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Post(":token/accept")
  @UseGuards(AuthGuard)
  async accept(
    @Req() req: AuthedRequest,
    @Param("token") token: string,
  ): Promise<{ org: OrgDto; role: Role }> {
    if (!req.auth) throw ApiException.orgAccessDenied("Missing authentication context.");
    return this.invitations.accept(token, req.auth);
  }
}
