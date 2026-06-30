import { Module } from "@nestjs/common";
import { SupabaseJwtVerifier } from "./supabase-jwt.verifier";
import { AuthGuard } from "./auth.guard";
import { TenantScopeGuard } from "./tenant-scope.guard";
import { RolesGuard } from "./roles.guard";
import { UserMirrorService } from "./user-mirror.service";
import { MembershipService } from "./membership.service";
import { MeController } from "./me.controller";

/**
 * Authentication & identity (docs/12). Verifies Supabase JWTs, mirrors users,
 * resolves memberships, and provides the tenant-scope + RBAC guards. Exports the
 * guards + services reused by the tenant-scoped feature modules (F1.6+).
 */
@Module({
  controllers: [MeController],
  providers: [
    SupabaseJwtVerifier,
    AuthGuard,
    TenantScopeGuard,
    RolesGuard,
    UserMirrorService,
    MembershipService,
  ],
  exports: [
    SupabaseJwtVerifier,
    AuthGuard,
    TenantScopeGuard,
    RolesGuard,
    UserMirrorService,
    MembershipService,
  ],
})
export class AuthModule {}
