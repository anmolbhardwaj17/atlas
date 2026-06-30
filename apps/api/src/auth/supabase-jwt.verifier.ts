import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Env } from "@atlas/config";
import { ENV } from "../core/tokens";

/**
 * Verifies Supabase-issued user access tokens (docs/12 §2.1). Atlas mints no
 * tokens; it only verifies. Primary path: the project's asymmetric signing key
 * (ES256) fetched from Supabase's JWKS (cached/rotated by `jose`). Checks issuer
 * (`<SUPABASE_URL>/auth/v1`) and audience (`authenticated`); `exp` is enforced by
 * `jwtVerify`. Legacy HS256 (shared `SUPABASE_JWT_SECRET`) is a fallback only for
 * projects without asymmetric keys.
 */
@Injectable()
export class SupabaseJwtVerifier {
  private readonly logger = new Logger(SupabaseJwtVerifier.name);
  private readonly issuer: string;
  private readonly jwks: JWTVerifyGetKey;
  private readonly hmacSecret: Uint8Array | null;

  constructor(@Inject(ENV) env: Env) {
    if (!env.SUPABASE_URL) {
      throw new Error("SUPABASE_URL is required for auth (docs/12 §2.1)");
    }
    const base = env.SUPABASE_URL.replace(/\/+$/, "");
    this.issuer = `${base}/auth/v1`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    this.hmacSecret = env.SUPABASE_JWT_SECRET
      ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
      : null;
  }

  async verify(token: string): Promise<JWTPayload> {
    const options = { issuer: this.issuer, audience: "authenticated" } as const;
    try {
      const { payload } = await jwtVerify(token, this.jwks, options);
      return payload;
    } catch (asymmetricError) {
      if (this.hmacSecret) {
        try {
          const { payload } = await jwtVerify(token, this.hmacSecret, options);
          return payload;
        } catch (hmacError) {
          this.logger.debug(`HS256 fallback failed: ${(hmacError as Error).message}`);
        }
      }
      this.logger.debug(`JWT verification failed: ${(asymmetricError as Error).message}`);
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
