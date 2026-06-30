import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@atlas/db";
import { ROLES_KEY } from "./roles.decorator";
import { ApiException } from "../common/errors";
import type { AuthedRequest } from "./auth.types";

const RANK: Record<Role, number> = { Member: 1, Admin: 2, Owner: 3 };

/**
 * Enforces the `@Roles(min)` minimum against `req.org.role` (set by
 * TenantScopeGuard). Insufficient → 403 insufficient_role (docs/12 §5.2, docs/08
 * §11). No `@Roles` decorator → no role requirement (membership alone suffices).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const role = req.org?.role;
    if (!role || RANK[role] < RANK[required]) {
      throw ApiException.insufficientRole(`Requires ${required} role.`);
    }
    return true;
  }
}
