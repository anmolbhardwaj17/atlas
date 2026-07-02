import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { MembershipService } from "./membership.service";
import { ApiException } from "../common/errors";
import type { AuthedRequest } from "./auth.types";

/**
 * Resolves the active org + the caller's role LIVE per request (docs/12 §4) and
 * attaches it as `req.org`. Source of the org id: the `orgId` route param (for
 * `/orgs/{orgId}/...`) or the `X-Atlas-Org` header. Membership is verified via the
 * SECURITY DEFINER resolver - no active membership means:
 *   - path id  → 404 not_found  (never leak another tenant's existence - R8/US-12)
 *   - header   → 403 org_access_denied
 * Must run AFTER AuthGuard (needs `req.auth`).
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  constructor(private readonly memberships: MembershipService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const claims = req.auth;
    if (!claims) throw new UnauthorizedException("Missing authentication context");

    const fromPath = req.params?.orgId;
    const headerRaw = req.headers["x-atlas-org"];
    const fromHeader = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    const orgId = fromPath ?? fromHeader;
    if (!orgId) {
      throw ApiException.orgAccessDenied(
        "No organization selected - use an /orgs/{orgId} route or set the X-Atlas-Org header.",
      );
    }

    const match = (await this.memberships.listForUser(claims.userId)).find((m) => m.id === orgId);
    if (!match) {
      throw fromPath ? ApiException.notFound() : ApiException.orgAccessDenied();
    }

    req.org = { id: match.id, slug: match.slug, name: match.name, role: match.role };
    return true;
  }
}
