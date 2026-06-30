import { SetMetadata } from "@nestjs/common";
import type { Role } from "@atlas/db";

export const ROLES_KEY = "atlas:min_role";

/**
 * Minimum role required for a handler (docs/12 §5 RBAC matrix). Enforced by
 * `RolesGuard` against the live-resolved org role. Hierarchy: Owner > Admin > Member.
 */
export const Roles = (min: Role): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, min);
