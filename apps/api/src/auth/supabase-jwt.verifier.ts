import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { Env } from "@atlas/config";
import { ENV } from "../core/tokens";

/**
 * Verifies Supabase-issued user access tokens (docs/12 §2.1). Atlas mints no tokens; it only
 * verifies. Primary path: the project's asymmetric signing key (ES256) fetched from Supabase's JWKS
 * (cached/rotated by `jose`). Checks issuer (`<SUPABASE_URL>/auth/v1`) and audience
 * (`authenticated`); `exp` is enforced by `jwtVerify`.
 *
 * Legacy HS256 (shared `SUPABASE_JWT_SECRET`) is a fallback only for projects without asymmetric
 * keys. Hardened (security sweep M2): the primary pins `algorithms: ["ES256"]` and the fallback pins
 * `["HS256"]` (defence-in-depth against alg-confusion); the fallback is only tried when the primary
 * failed for a KEY/ALG reason (a project genuinely on HS256), never when the token verified-but-
 * failed a claim (expired / wrong issuer or audience → 401 regardless) nor on a transient JWKS
 * network error; and the shared secret is ignored unless it's ≥32 bytes (a weak static secret is the
 * whole risk — a leak lets an attacker mint `sub`/`email_verified` at will).
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
    this.jwks = this.createJwks(this.issuer);
    const secret = env.SUPABASE_JWT_SECRET;
    if (secret && secret.length < 32) {
      // A short static HS256 secret is brute-forceable — worse than no fallback. Refuse to use it.
      this.logger.warn(
        "SUPABASE_JWT_SECRET is under 32 characters; HS256 fallback is DISABLED (use asymmetric ES256 keys).",
      );
    }
    this.hmacSecret = secret && secret.length >= 32 ? new TextEncoder().encode(secret) : null;
  }

  /** Overridable in tests so verification can run without a live JWKS endpoint. */
  protected createJwks(issuer: string): JWTVerifyGetKey {
    return createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }

  async verify(token: string): Promise<JWTPayload> {
    const options = { issuer: this.issuer, audience: "authenticated" } as const;
    try {
      const { payload } = await jwtVerify(token, this.jwks, { ...options, algorithms: ["ES256"] });
      return payload;
    } catch (primaryError) {
      // Fall back to the shared HS256 secret ONLY when the primary failed because no asymmetric key
      // matched / the alg wasn't ES256 (i.e. the project is on HS256). An expired token, a wrong
      // issuer/audience, or a JWKS network blip must NOT trigger the fallback — that's a 401.
      if (this.hmacSecret && isKeyOrAlgError(primaryError)) {
        try {
          const { payload } = await jwtVerify(token, this.hmacSecret, {
            ...options,
            algorithms: ["HS256"],
          });
          return payload;
        } catch (hmacError) {
          this.logger.debug(`HS256 fallback failed: ${(hmacError as Error).message}`);
        }
      }
      this.logger.debug(`JWT verification failed: ${(primaryError as Error).message}`);
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}

/** jose tags errors with a stable `code`. These mean "this key/alg can't verify it" — the only
 *  reasons to try the HS256 fallback. Anything else (expired, bad claim, network) is a hard 401. */
function isKeyOrAlgError(e: unknown): boolean {
  const code = (e as { code?: string }).code;
  return (
    code === "ERR_JWKS_NO_MATCHING_KEY" ||
    code === "ERR_JOSE_ALG_NOT_ALLOWED" ||
    code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS"
  );
}
