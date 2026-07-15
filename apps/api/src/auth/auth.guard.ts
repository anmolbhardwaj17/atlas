import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { SupabaseJwtVerifier } from "./supabase-jwt.verifier";
import { parseAuthClaims } from "./claims";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { AuthedRequest } from "./auth.types";

/**
 * Authenticates a request from its `Authorization: Bearer <supabase-jwt>` header
 * (docs/12 §4 step 1). On success, attaches trusted `AuthClaims` to the request.
 * Authorization (org/role) is resolved downstream - the token carries no tenancy.
 *
 * Registered as a GLOBAL guard (APP_GUARD), so every route is authenticated by default and a new
 * controller can't be left open by forgetting a guard. Routes marked `@Public()` (webhook / digest
 * unsubscribe / health — authenticated by another means) are skipped.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly verifier: SupabaseJwtVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw || !raw.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const token = raw.slice("Bearer ".length).trim();
    const payload = await this.verifier.verify(token);
    req.auth = parseAuthClaims(payload);
    return true;
  }
}
