import { Module } from "@nestjs/common";
import { SupabaseJwtVerifier } from "./supabase-jwt.verifier";
import { AuthGuard } from "./auth.guard";
import { UserMirrorService } from "./user-mirror.service";
import { MembershipService } from "./membership.service";
import { MeController } from "./me.controller";

/**
 * Authentication & identity (docs/12). Verifies Supabase JWTs, mirrors users, and
 * resolves memberships. Exports the guard + membership resolver for reuse by the
 * tenant-scoped feature modules (F1.6).
 */
@Module({
  controllers: [MeController],
  providers: [SupabaseJwtVerifier, AuthGuard, UserMirrorService, MembershipService],
  exports: [SupabaseJwtVerifier, AuthGuard, MembershipService],
})
export class AuthModule {}
