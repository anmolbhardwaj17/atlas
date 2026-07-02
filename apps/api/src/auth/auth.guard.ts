import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { SupabaseJwtVerifier } from "./supabase-jwt.verifier";
import { parseAuthClaims } from "./claims";
import type { AuthedRequest } from "./auth.types";

/**
 * Authenticates a request from its `Authorization: Bearer <supabase-jwt>` header
 * (docs/12 §4 step 1). On success, attaches trusted `AuthClaims` to the request.
 * Authorization (org/role) is resolved downstream - the token carries no tenancy.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly verifier: SupabaseJwtVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
